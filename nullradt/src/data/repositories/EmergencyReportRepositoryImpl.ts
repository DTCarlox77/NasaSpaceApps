import type { ConfirmOkOutcome, DeliveryResult, EmergencyReport, EmergencySessionInfo } from '@/domain/entities/EmergencyReport';
import type { EmergencyReportRepository } from '@/domain/repositories/EmergencyReportRepository';
import { newUuid } from '@/domain/usecases/uuid';
import type { LocalTriageSession } from '@/domain/entities/Triage';
import { triageLocalDataSource } from '../datasources/local/triageLocalDataSource';
import type { ApiSessionWithRoster } from '../datasources/remote/apiTypes';
import { emergencyRemoteDataSource } from '../datasources/remote/emergencyRemoteDataSource';
import { HttpError } from '../datasources/remote/httpClient';
import { ANY_OWNER, sendOrQueue, serverSession } from './outbox';
import { apiEnabled } from '@/core/config/env';

function toInfo(res: ApiSessionWithRoster): EmergencySessionInfo {
  return {
    id: res.session.id,
    status: res.session.status,
    joined: !!res.joined,
    nextStep: res.session.next_step ?? null,
    startedAt: res.session.started_at,
    missionCode: res.session.mission_code,
    roster: (res.roster ?? []).map((r) => r.call_sign ?? '').filter(Boolean),
  };
}

/**
 * Emergencia (guía §10):
 * - CRÍTICO → POST /emergency/sessions (`trigger_type: manual_button`). Sin conexión: cola con prioridad
 *   `emergency` (se sube antes que todo). Ante cualquier error se encola: una emergencia nunca se pierde.
 * - PRECAUCIÓN → NO es una emergencia y el contrato no tiene endpoint: queda solo en el dispositivo.
 * - Sin API (demo) → solo en el dispositivo.
 */
export class EmergencyReportRepositoryImpl implements EmergencyReportRepository {
  constructor(private readonly remote = emergencyRemoteDataSource) {}

  /** Guarda la sesión en el dispositivo para el triaje (también sin conexión o en modo demo). */
  private remember(report: EmergencyReport, patch: Partial<LocalTriageSession> & Pick<LocalTriageSession, 'ref' | 'status'>) {
    const session: LocalTriageSession = {
      serverId: null,
      clientUuid: report.id,
      startedAt: report.createdAt,
      context: report.solarEventActive !== undefined ? { solar_event_active: report.solarEventActive } : {},
      responderSafe: report.responderSafe ?? null,
      responderSafeAnswer: null,
      protocolVersion: null,
      joined: false,
      mergedInto: null,
      demo: false,
      ...patch,
    };
    return triageLocalDataSource.saveSession(session).catch(() => {});
  }

  async submit(report: EmergencyReport): Promise<DeliveryResult> {
    if (report.severity !== 'critical') return { status: 'local', report };
    if (!apiEnabled()) {
      // Modo demo: el triaje funciona igual, todo en el dispositivo.
      await this.remember(report, { ref: report.id, status: 'demo', demo: true });
      return { status: 'local', report };
    }
    const session = await serverSession();
    const payload: Record<string, unknown> = {
      trigger_type: 'manual_button',
      started_at: report.createdAt,
      ...(report.solarEventActive !== undefined ? { context: { solar_event_active: report.solarEventActive } } : {}),
      ...(report.responderSafe !== undefined ? { responder_safe: { value: report.responderSafe } } : {}),
    };
    // Sin sesión (SOS desde el login) no hay token: se encola y la sube la próxima sesión (guía §12).
    if (!session) {
      await sendOrQueue({
        clientUuid: report.id,
        entity: 'emergency_session',
        priority: 'emergency',
        ownerId: ANY_OWNER,
        payload,
        send: () => Promise.reject(new HttpError('no session')),
        queueOnAnyError: true,
      });
      await this.remember(report, { ref: report.id, status: 'queued' });
      return { status: 'queued', report, reason: 'no session' };
    }
    const res = await sendOrQueue({
      clientUuid: report.id,
      entity: 'emergency_session',
      priority: 'emergency',
      ownerId: session.userId,
      payload,
      send: () => this.remote.openSession({ client_uuid: report.id, ...payload }),
      queueOnAnyError: true,
    });
    if (res.kind === 'queued') {
      await this.remember(report, { ref: report.id, status: 'queued' });
      return { status: 'queued', report, reason: 'offline' };
    }
    const s = res.value.session;
    const joined = !!res.value.joined;
    await this.remember(report, {
      ref: s.id,
      serverId: s.id,
      status: s.status,
      startedAt: s.started_at,
      context: s.context ?? (report.solarEventActive !== undefined ? { solar_event_active: report.solarEventActive } : {}),
      responderSafe: s.responder_safe ?? report.responderSafe ?? null,
      // Al unirte a una sesión abierta, tu propia respuesta "¿estás a salvo?" vale para ti en este dispositivo.
      responderSafeAnswer:
        joined && report.responderSafe !== undefined && report.responderSafe !== s.responder_safe
          ? { clientUuid: newUuid(), questionCode: 'responder_safe', answer: { value: report.responderSafe }, source: 'tap', answeredAt: report.createdAt }
          : null,
      protocolVersion: s.protocol?.version ?? null,
      missionCode: s.mission_code,
      joined,
    });
    return { status: 'sent', report, session: toInfo(res.value) };
  }

  async getSession(id: string): Promise<EmergencySessionInfo | null> {
    if (!(await serverSession())) return null;
    try {
      return toInfo(await this.remote.getSession(id));
    } catch {
      return null;
    }
  }

  async confirmOk(sessionId: string): Promise<ConfirmOkOutcome> {
    const session = await serverSession();
    const payload = { session_id: sessionId, confirmed_at: new Date().toISOString() };
    try {
      const res = await sendOrQueue({
        clientUuid: newUuid(),
        entity: 'emergency_confirm',
        priority: 'emergency',
        ownerId: session?.userId ?? ANY_OWNER,
        payload,
        send: () => this.remote.confirm(sessionId, { confirmed_at: payload.confirmed_at }),
      });
      return res.kind === 'queued' ? 'queued' : 'confirmed';
    } catch (e) {
      if (e instanceof HttpError && e.code === 'DEADMAN_EXPIRED') return 'expired';
      throw e;
    }
  }

  async close(sessionId: string, status: 'closed' | 'cancelled', notes?: string): Promise<'closed' | 'queued' | 'forbidden'> {
    const session = await serverSession();
    if (!session) return 'forbidden';
    const body = { closed_at: new Date().toISOString(), status, ...(notes ? { notes } : {}) };
    try {
      const res = await sendOrQueue({
        clientUuid: newUuid(),
        entity: 'emergency_close',
        priority: 'emergency',
        ownerId: session.userId,
        payload: { session_id: sessionId, ...body },
        send: () => this.remote.close(sessionId, body),
      });
      return res.kind === 'queued' ? 'queued' : 'closed';
    } catch (e) {
      if (e instanceof HttpError && e.status === 403) return 'forbidden';
      throw e;
    }
  }
}
