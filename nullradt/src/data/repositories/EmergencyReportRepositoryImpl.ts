import type { ConfirmOkOutcome, DeliveryResult, EmergencyReport, EmergencySessionInfo } from '@/domain/entities/EmergencyReport';
import type { EmergencyReportRepository } from '@/domain/repositories/EmergencyReportRepository';
import { newUuid } from '@/domain/usecases/uuid';
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

  async submit(report: EmergencyReport): Promise<DeliveryResult> {
    if (!apiEnabled() || report.severity !== 'critical') return { status: 'local', report };
    const session = await serverSession();
    const payload: Record<string, unknown> = {
      trigger_type: 'manual_button',
      started_at: report.createdAt,
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
    if (res.kind === 'queued') return { status: 'queued', report, reason: 'offline' };
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
