import type { OutboxItem, SyncEntity } from '@/domain/entities/Sync';
import type {
  AttentionRow,
  CurrentAssessment,
  EarthQuestion,
  LocalAnswer,
  LocalAssessment,
  LocalTriageSession,
  ServerAssessmentResult,
  StoredProtocol,
  TriageRosterEntry,
  TriageSessionView,
} from '@/domain/entities/Triage';
import type { TriageRepository } from '@/domain/repositories/TriageRepository';
import { answeredOnPath, deviceAttentionOrder, evaluateLocal, toDeviceResult } from '@/domain/usecases/triageLocal';
import { newUuid } from '@/domain/usecases/uuid';
import { outboxLocalDataSource } from '../datasources/local/outboxLocalDataSource';
import { sessionSecureDataSource } from '../datasources/local/sessionSecureDataSource';
import { FALLBACK_PROTOCOL, triageLocalDataSource } from '../datasources/local/triageLocalDataSource';
import type { ApiAssessment, ApiAssessmentResult, ApiSessionWithRoster } from '../datasources/remote/apiTypes';
import { emergencyRemoteDataSource } from '../datasources/remote/emergencyRemoteDataSource';
import { HttpError } from '../datasources/remote/httpClient';
import { serverSession } from './outbox';

const now = () => new Date().toISOString();
/** GET de la sesión con un tope corto: la pantalla ya muestra lo del dispositivo mientras tanto. */
const SESSION_TIMEOUT_MS = 8000;
const isRetryable = (e: unknown) => (e instanceof HttpError ? e.isRetryable : true);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

export function toServerResult(r: ApiAssessmentResult): ServerAssessmentResult {
  return {
    status: r.status,
    triageCategory: r.triage_category ?? null,
    radiationFlag: r.radiation_flag ?? null,
    rulesVersion: r.rules_version ?? null,
    matchesDevice: r.matches_device ?? null,
    mismatchFields: r.mismatch_fields ?? [],
    escalations: (r.escalations ?? []).map((e) => ({
      level: e.level,
      priority: e.priority,
      escalationId: e.escalation_id ?? null,
      deliverAt: e.deliver_at ?? null,
    })),
    receivedAt: now(),
  };
}

/** Evaluación vigente por tripulante: la última completada (reevaluar manda), como en el servidor. */
function currentFrom(server: ApiAssessment[], local: LocalAssessment[]): Record<string, CurrentAssessment> {
  const out: Record<string, CurrentAssessment> = {};
  const byUuid = new Map(local.map((l) => [l.clientUuid, l]));
  const put = (c: CurrentAssessment) => {
    const prev = out[c.astronautId];
    const rank = (x: CurrentAssessment) => (x.status === 'completed' ? 1 : 0);
    if (!prev || rank(c) > rank(prev) || (rank(c) === rank(prev) && (c.completedAt ?? '') >= (prev.completedAt ?? ''))) out[c.astronautId] = c;
  };
  const seen = new Set<string>();
  for (const a of server) {
    seen.add(a.client_uuid);
    if (a.status === 'unreachable') continue;
    put({
      astronautId: a.astronaut_id,
      status: a.status === 'completed' ? 'completed' : 'in_progress',
      triageCategory: a.triage_category ?? null,
      radiationFlag: a.radiation_flag ?? null,
      computedBy: 'server',
      matchesDevice: a.matches_device ?? null,
      completedAt: a.completed_at ?? null,
      local: byUuid.get(a.client_uuid) ?? null,
    });
  }
  for (const l of local) {
    if (seen.has(l.clientUuid)) continue;
    const done = !!l.completedAt && !!l.device;
    const fromServer = !!l.server && l.server.status === 'completed';
    if (!done && l.answers.length === 0) continue; // borrador vacío: no cuenta como "en curso"
    put({
      astronautId: l.astronautId,
      status: done ? 'completed' : 'in_progress',
      triageCategory: fromServer ? l.server!.triageCategory : (l.device?.triage_category ?? null),
      radiationFlag: fromServer ? l.server!.radiationFlag : (l.device?.radiation_flag ?? null),
      computedBy: fromServer ? 'server' : 'device',
      matchesDevice: l.server?.matchesDevice ?? null,
      completedAt: l.completedAt,
      local: l,
    });
  }
  return out;
}

/**
 * Triaje (guía §10): protocolo guardado + evaluador local + envío por pasos o a la cola.
 * - En línea: POST assessments → PUT answers → POST complete (device_result). El resultado del servidor manda.
 * - Sin enlace (o si la sesión sigue en la cola): todo a la cola con prioridad `emergency` y referencias por
 *   client_uuid (`session_id`, `assessment_id`). El servidor procesa sesión → evaluación → respuestas → completar.
 * - Modo demo (sin API): todo queda en el dispositivo.
 */
export class TriageRepositoryImpl implements TriageRepository {
  constructor(
    private readonly remote = emergencyRemoteDataSource,
    private readonly local = triageLocalDataSource,
    private readonly outbox = outboxLocalDataSource,
  ) {}

  // ---------------------------------------------------------------- protocolo

  async refreshProtocol(version?: number): Promise<StoredProtocol | null> {
    if (!(await serverSession())) return null;
    try {
      const p = await this.remote.getProtocol(version);
      const stored: StoredProtocol = {
        code: p.code,
        version: p.version,
        name: p.name,
        definition: p.definition,
        sources: p.sources ?? [],
        origin: 'server',
        fetchedAt: now(),
      };
      // Sin `?version` es el activo; con `?version` es una versión vieja para una sesión concreta.
      await this.local.saveProtocol(stored, version === undefined);
      return stored;
    } catch {
      return null;
    }
  }

  async getProtocol(version?: number | null, opts: { network?: boolean } = {}): Promise<StoredProtocol> {
    const store = await this.local.getProtocols();
    if (version) {
      const exact = store.byVersion[String(version)];
      if (exact) return exact;
      // Una sesión se evalúa con SU versión: si no está guardada, GET /emergency/protocol?version=N.
      const fetched = opts.network === false ? null : await this.refreshProtocol(version);
      if (fetched) return fetched;
      if (version === FALLBACK_PROTOCOL.version) return FALLBACK_PROTOCOL;
    }
    const active = store.active ? store.byVersion[String(store.active)] : undefined;
    return active ?? FALLBACK_PROTOCOL;
  }

  // ---------------------------------------------------------------- sesión

  async rememberSession(session: LocalTriageSession): Promise<void> {
    const prev = await this.local.getSession(session.ref);
    await this.local.saveSession(prev ? { ...prev, ...session, responderSafeAnswer: session.responderSafeAnswer ?? prev.responderSafeAnswer } : session);
  }

  async loadSession(
    ref: string,
    fallbackRoster: () => Promise<{ entries: TriageRosterEntry[]; source: TriageSessionView['rosterSource'] }>,
    opts: { remote: boolean },
  ): Promise<TriageSessionView | null> {
    let session = await this.local.getSession(ref);
    let api: ApiSessionWithRoster | null = null;
    if (opts.remote && !session?.demo && (await serverSession())) {
      try {
        api = await this.remote.getSession(session?.serverId ?? ref, SESSION_TIMEOUT_MS);
      } catch {
        api = null;
      }
    }
    if (!session && !api) return null;

    if (api) {
      const s = api.session;
      const base: LocalTriageSession = session ?? {
        ref,
        serverId: s.id,
        clientUuid: null,
        status: s.status,
        startedAt: s.started_at,
        context: {},
        responderSafe: null,
        responderSafeAnswer: null,
        protocolVersion: null,
        joined: true,
        mergedInto: null,
        demo: false,
      };
      session = {
        ...base,
        serverId: s.id,
        status: s.status,
        startedAt: s.started_at,
        context: s.context ?? base.context,
        responderSafe: s.responder_safe ?? base.responderSafe,
        protocolVersion: s.protocol?.version ?? base.protocolVersion,
        missionCode: s.mission_code ?? base.missionCode,
        mergedInto: s.merged_into ?? base.mergedInto,
      };
      await this.local.saveSession(session);
    }
    const current = session!;

    // A quién evaluar: el roster del servidor; sin enlace, la tripulación vigente guardada.
    const fallback = api?.roster?.length ? null : await fallbackRoster();
    const roster: TriageRosterEntry[] = api?.roster?.length
      ? api.roster.map((r, i) => ({
          astronautId: r.astronaut_id,
          callSign: r.call_sign ?? r.astronaut_id.slice(0, 8),
          crewRole: r.crew_role ?? null,
          sequenceNo: r.sequence_no ?? i + 1,
          priorityReason: r.priority_reason ?? null,
        }))
      : fallback!.entries;

    const local = await this.local.assessmentsOf(current.ref);
    const byAstronaut = currentFrom(api?.assessments ?? [], local);
    // El orden del servidor manda; si hay evaluaciones de la tableta que aún no subieron, se calcula aquí.
    const pendingLocal = local.some((l) => l.completedAt && l.delivery !== 'sent');
    const protocol = await this.getProtocol(current.protocolVersion, { network: !!api });
    let attention: AttentionRow[];
    let attentionSource: TriageSessionView['attentionSource'];
    if (api?.attention_order && !pendingLocal) {
      attention = api.attention_order.map((e) => ({
        position: e.position,
        astronautId: e.astronaut_id,
        callSign: e.call_sign,
        status: e.status,
        triageCategory: e.triage_category ?? null,
        radiationFlag: e.radiation_flag ?? null,
        matchesDevice: e.matches_device ?? null,
        reason: e.reason,
      }));
      attentionSource = 'server';
    } else {
      attention = deviceAttentionOrder(protocol.definition, roster, byAstronaut);
      attentionSource = 'device';
    }

    const safe = current.responderSafeAnswer ? (current.responderSafeAnswer.answer as { value: boolean }).value : current.responderSafe;
    const nextStep = safe === false ? 'secure_self' : safe === true ? 'start_assessments' : (api?.session.next_step ?? null);

    return {
      session: current,
      fromServer: !!api,
      nextStep,
      roster,
      rosterSource: fallback ? fallback.source : 'server',
      attention,
      attentionSource,
      current: byAstronaut,
      questions: await this.local.questionsOf(current.ref),
      heartbeatExpiresAt: api?.session.heartbeat?.expires_at ?? null,
    };
  }

  async answerResponderSafe(ref: string, answer: LocalAnswer): Promise<void> {
    await this.local.updateSession(ref, (s) => ({ ...s, responderSafeAnswer: answer }));
  }

  async markClosed(ref: string, status: 'closed' | 'cancelled'): Promise<void> {
    await this.local.updateSession(ref, (s) => ({ ...s, status }));
  }

  // ---------------------------------------------------------------- evaluación

  async startAssessment(ref: string, member: TriageRosterEntry, protocolVersion: number): Promise<LocalAssessment> {
    const session = await this.local.getSession(ref);
    const assessment: LocalAssessment = {
      clientUuid: newUuid(),
      sessionRef: session?.ref ?? ref,
      astronautId: member.astronautId,
      callSign: member.callSign,
      startedAt: now(),
      completedAt: null,
      protocolVersion,
      answers: [],
      device: null,
      server: null,
      delivery: 'draft',
      serverId: null,
      error: null,
    };
    await this.local.saveAssessment(assessment);
    return assessment;
  }

  getAssessment(clientUuid: string) {
    return this.local.getAssessment(clientUuid);
  }

  saveAnswers(clientUuid: string, answers: LocalAnswer[]) {
    return this.local.updateAssessment(clientUuid, (a) => ({ ...a, answers }));
  }

  private async enqueue(entity: SyncEntity, clientUuid: string, ownerId: string, payload: Record<string, unknown>, error?: unknown) {
    await this.outbox.add({
      clientUuid,
      entity,
      priority: 'emergency',
      createdAt: now(),
      payload,
      ownerId,
      attempts: error ? 1 : 0,
      lastError: error instanceof Error ? error.message : undefined,
    });
  }

  async completeAssessment(clientUuid: string): Promise<LocalAssessment> {
    let a = await this.local.getAssessment(clientUuid);
    if (!a) throw new Error('assessment not found');
    const session = await this.local.getSession(a.sessionRef);
    if (!session) throw new Error('session not found');
    const protocol = await this.getProtocol(a.protocolVersion);
    const result = evaluateLocal(protocol.definition, session, a.answers);
    if (result.status !== 'completed') throw new Error('assessment incomplete');

    // responder_safe contestado en este dispositivo viaja con la evaluación (el servidor lo copia a la sesión).
    let answers = a.answers;
    if (session.responderSafeAnswer && !answers.some((x) => x.questionCode === 'responder_safe')) {
      answers = [...answers, { ...session.responderSafeAnswer, clientUuid: newUuid() }];
    }
    const device = toDeviceResult(result, protocol.version);
    a = (await this.local.updateAssessment(a.clientUuid, (x) => ({
      ...x,
      answers,
      device,
      completedAt: x.completedAt ?? now(),
      error: null,
    })))!;

    if (session.demo) {
      return (await this.local.updateAssessment(a.clientUuid, (x) => ({ ...x, delivery: 'local' })))!;
    }
    const owner = await serverSession();
    if (!owner) throw new Error('no session');

    // Solo las respuestas del recorrido final (si se volvió atrás, las de otra rama no se mandan).
    const onPath = new Set([...answeredOnPath(result), 'responder_safe']);
    const toSend = answers.filter((x) => onPath.has(x.questionCode) && (x.questionCode !== 'responder_safe' || session.responderSafeAnswer));
    const assessmentBody = { astronaut_id: a.astronautId, started_at: a.startedAt, is_self_assessment: owner.astronautId === a.astronautId };
    const completeBody = { completed_at: a.completedAt!, device_result: device };
    const sessionRef = session.serverId ?? session.ref;

    // Si la sesión sigue en la cola, el servidor aún no la conoce: todo va a la cola detrás de ella.
    let queued = !session.serverId;
    let serverId = a.serverId;
    let server: ServerAssessmentResult | null = null;
    try {
      if (!queued && !serverId) {
        try {
          serverId = (await this.remote.createAssessment(sessionRef, { client_uuid: a.clientUuid, ...assessmentBody })).id;
        } catch (e) {
          if (!isRetryable(e)) throw e;
          queued = true;
        }
      }
      if (queued) await this.enqueue('emergency_assessment', a.clientUuid, owner.userId, { session_id: sessionRef, ...assessmentBody });

      const wire = (x: LocalAnswer) => ({ question_code: x.questionCode, answer: x.answer, source: x.source, answered_at: x.answeredAt });
      if (!queued && toSend.length) {
        try {
          await this.remote.putAnswers(serverId!, { answers: toSend.map((x) => ({ client_uuid: x.clientUuid, ...wire(x) })) });
        } catch (e) {
          if (!isRetryable(e)) throw e;
          queued = true;
        }
      }
      if (queued) {
        for (const x of toSend) await this.enqueue('emergency_answer', x.clientUuid, owner.userId, { assessment_id: a.clientUuid, ...wire(x) });
      }

      if (!queued) {
        try {
          server = toServerResult(await this.remote.complete(serverId!, completeBody));
        } catch (e) {
          if (!isRetryable(e)) throw e;
          queued = true;
        }
      }
      if (queued) await this.enqueue('emergency_complete', newUuid(), owner.userId, { assessment_id: a.clientUuid, ...completeBody });
    } catch (e) {
      // 4xx: el servidor rechazó (p. ej. sesión cerrada o respuestas fuera del protocolo). Se muestra el error.
      const message = e instanceof HttpError ? (e.code ?? e.message) : 'error';
      return (await this.local.updateAssessment(a.clientUuid, (x) => ({ ...x, serverId, error: message })))!;
    }

    return (await this.local.updateAssessment(a.clientUuid, (x) => ({
      ...x,
      serverId,
      server: server ?? x.server,
      delivery: queued ? 'queued' : 'sent',
      error: null,
    })))!;
  }

  // ---------------------------------------------------------------- latido y preguntas

  async heartbeat(ref: string): Promise<'sent' | 'queued' | 'skipped'> {
    const session = await this.local.getSession(ref);
    const owner = await serverSession();
    if (!session || session.demo || !owner) return 'skipped';
    if (session.status === 'closed' || session.status === 'cancelled') return 'skipped';
    const body = { sent_at: now(), device_id: await sessionSecureDataSource.getDeviceId() };
    const sessionRef = session.serverId ?? session.ref;
    if (session.serverId) {
      try {
        await this.remote.heartbeat(session.serverId, body);
        return 'sent';
      } catch (e) {
        if (!isRetryable(e)) return 'skipped';
      }
    }
    // Sin enlace: un solo latido en cola por sesión (el más reciente).
    await this.outbox.replace(
      (i) => i.entity === 'emergency_heartbeat' && i.payload.session_id === sessionRef,
      { clientUuid: newUuid(), entity: 'emergency_heartbeat', priority: 'emergency', createdAt: body.sent_at, payload: { session_id: sessionRef, ...body }, ownerId: owner.userId, attempts: 0 },
    );
    return 'queued';
  }

  async askEarth(ref: string, body: string): Promise<EarthQuestion> {
    const session = await this.local.getSession(ref);
    const owner = await serverSession();
    if (!session || session.demo || !owner) throw new Error('no session');
    const question: EarthQuestion = { clientUuid: newUuid(), sessionRef: session.ref, body, askedAt: now(), deliverAt: null, delivery: 'queued' };
    const sessionRef = session.serverId ?? session.ref;
    let sent = false;
    if (session.serverId) {
      try {
        const res = await this.remote.askEarth(session.serverId, { client_uuid: question.clientUuid, body, asked_at: question.askedAt });
        question.deliverAt = res.deliver_at;
        question.delivery = 'sent';
        sent = true;
      } catch (e) {
        if (!isRetryable(e)) throw e;
      }
    }
    if (!sent) await this.enqueue('emergency_question', question.clientUuid, owner.userId, { session_id: sessionRef, body, asked_at: question.askedAt });
    await this.local.saveQuestion(question);
    return question;
  }

  // ---------------------------------------------------------------- resultados del push

  async applyPushResult(item: OutboxItem, status: string, result: Record<string, unknown> | null): Promise<boolean> {
    const ok = status === 'accepted' || status === 'duplicate';
    const res = result ?? {};
    switch (item.entity) {
      case 'emergency_session': {
        if (!ok) return false;
        const updated = await this.local.updateSession(item.clientUuid, (s) => ({
          ...s,
          serverId: str(res.session_id) ?? s.serverId,
          status: (str(res.status) as LocalTriageSession['status'] | null) ?? s.status,
          joined: !!res.joined || s.joined,
          mergedInto: str(res.merged_into) ?? s.mergedInto,
        }));
        return !!updated;
      }
      case 'emergency_assessment':
        if (!ok) return false;
        return !!(await this.local.updateAssessment(item.clientUuid, (a) => ({ ...a, serverId: str(res.assessment_id) ?? a.serverId })));
      case 'emergency_complete': {
        const ref = str(item.payload.assessment_id);
        if (!ref) return false;
        const updated = await this.local.updateAssessment(ref, (a) =>
          ok && typeof res.status === 'string'
            ? { ...a, server: toServerResult(res as unknown as ApiAssessmentResult), delivery: 'sent', error: null }
            : { ...a, error: status },
        );
        return !!updated;
      }
      case 'emergency_question':
        if (!ok) return false;
        return !!(await this.local.updateQuestion(item.clientUuid, (q) => ({ ...q, deliverAt: str(res.deliver_at), delivery: 'sent' })));
      case 'emergency_close': {
        if (!ok) return false;
        const st = str(res.status);
        if (st !== 'closed' && st !== 'cancelled') return false;
        return !!(await this.local.updateSession(str(item.payload.session_id) ?? '', (s) => ({ ...s, status: st })));
      }
      default:
        return false;
    }
  }
}
