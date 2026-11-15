/**
 * Adaptador del modo demo sin servidor (VITE_DATA_MODE=mock). Responde por método + ruta del
 * contrato v1.8 con los mismos esquemas JSON y los mismos códigos de error que la API, y aplica
 * las mismas reglas de acceso (x-roles y confidencialidad):
 * - 401 UNAUTHENTICATED sin token válido; 403 FORBIDDEN si el rol no está en el x-roles.
 * - Todo lo conductual (bandeja, detalle, acuses, cierres, auditoría): solo behavioral_health.
 * - admin: sin alertas de bienestar ni de SLEEP_HOURS en la bandeja, sin `triage`, `counts` null
 *   y la emergencia sin datos clínicos. 403 en hilo, acuse y respuesta de esas alertas y, por
 *   regla del panel, de las de category=emergency (solo estado operativo).
 * - flight_surgeon: `compliance` null en el dashboard.
 * - El check-in nunca trae la nota privada (no existe en los datos del demo).
 * - Lo que cruza el enlace usa `deliver_at`: la bandeja solo muestra lo que ya llegó; lo que Tierra
 *   manda llega a bordo en ahora + 90 s.
 */
import type {
  BehavioralInboxItem,
  ClosedItem,
  ConfidentialAccess,
  EmergencyDetail,
  EmergencyListItem,
  EmergencyQuestion,
  EscalationAck,
  EscalationMessage,
  InboxItem,
  Priority,
  Role,
  SupportMessage,
  SupportRequest,
  SupportRequestAck,
  TriageCounts,
} from '../types.ts';
import {
  ACCESS,
  ACCOUNT_ROUTES,
  astronautAccount,
  prepareSecrets,
  settlePasswords,
  userFromToken,
} from './accounts.ts';
import {
  BEHAVIORAL,
  checkMission,
  conflict,
  delivered,
  EVERYONE,
  fail,
  forbidden,
  GROUND,
  iso,
  json,
  me,
  MockHttpError,
  notFound,
  paginate,
  readBody,
  type Route,
  type Secrets,
} from './core.ts';
import type { MockAccount } from './fixtures/accounts.ts';
import {
  buildCheckins,
  buildIndicators,
  buildPvtRuns,
  buildScreenings,
  type MockSupportRequest,
} from './fixtures/behavioral.ts';
import type { MockEmergency } from './fixtures/emergencies.ts';
import { currentMission, DELAY_S, STANDARD_CATALOG } from './fixtures/mission.ts';
import { crewDashboard } from './fixtures/readings.ts';
import {
  addMessage,
  addSupportMessage,
  getState,
  patchBehavioralEscalation,
  patchEscalation,
  patchSupportRequest,
  persistState,
  type MockState,
} from './state.ts';

export { forgetMockState, resetMockState } from './state.ts';

// ---------------------------------------------------------------- configuración

let latencyMs = 150;

/** Latencia simulada (ms). Las pruebas la ponen en 0. */
export function configureMock(options: { latencyMs?: number }): void {
  if (options.latencyMs !== undefined) latencyMs = Math.max(0, options.latencyMs);
}

type MockUser = MockAccount;

const PRIORITY_RANK: Record<Priority, number> = { emergency: 0, urgent: 1, routine: 2 };

// ---------------------------------------------------------------- reglas de Tierra

/** Lo que admin no recibe (contrato): alertas de bienestar y de SLEEP_HOURS. */
const hiddenFromAdmin = (item: InboxItem) =>
  item.category === 'wellbeing' || item.evaluation?.code === 'SLEEP_HOURS';

/** admin: sin hilo, acuse ni respuesta en lo anterior y en category=emergency (solo estado operativo). */
const adminBlocked = (item: InboxItem) => hiddenFromAdmin(item) || item.category === 'emergency';

function groundEscalation(state: MockState, id: string, now: number): InboxItem {
  const item = state.escalations.find((e) => e.id === id);
  if (!item || !delivered(item.deliver_at, now)) {
    return notFound('El escalamiento no existe o todavía no llega a Tierra.');
  }
  return item;
}

function guardGround(user: MockUser, item: InboxItem): void {
  if (user.role === 'admin' && adminBlocked(item)) forbidden(['flight_surgeon']);
}

/** Campos del acuse si todavía no lo había (el primero se conserva: idempotente). */
function ackFields(item: { acknowledged_at?: string | null }, user: MockUser, now: number) {
  return item.acknowledged_at ? {} : { acknowledged_at: iso(now), acknowledged_by: user.id };
}

// ---------------------------------------------------------------- emergencias

function firstDelivered(emergency: MockEmergency): string | null {
  const times = emergency.detail.escalations
    .filter((e) => e.level === 'flight_surgeon' && e.deliver_at)
    .map((e) => e.deliver_at as string)
    .sort();
  return times[0] ?? null;
}

function countsOf(emergency: MockEmergency): TriageCounts {
  const counts: TriageCounts = { green: 0, yellow: 0, red: 0, black: 0, unreachable: 0, in_progress: 0 };
  // La evaluación más reciente de cada tripulante.
  const latest = new Map<string, EmergencyDetail['assessments'][number]>();
  for (const a of emergency.detail.assessments) latest.set(a.astronaut_id, a);
  for (const a of latest.values()) {
    if (a.status === 'in_progress') counts.in_progress += 1;
    else if (a.status === 'unreachable') counts.unreachable += 1;
    else if (a.triage_category) counts[a.triage_category] += 1;
  }
  return counts;
}

function visibleEmergency(state: MockState, id: string, now: number): MockEmergency {
  const emergency = state.emergencies.find((e) => e.detail.session.id === id);
  if (!emergency || !delivered(firstDelivered(emergency), now)) {
    return notFound('La emergencia no existe o todavía no llega a Tierra.');
  }
  return emergency;
}

function emergencyView(state: MockState, emergency: MockEmergency, role: Role, now: number): EmergencyDetail {
  const detail = structuredClone(emergency.detail);
  if (emergency.liveHeartbeat && detail.session.heartbeat) {
    // La tableta manda un latido cada 15 s.
    const last = Math.floor((now - 5_000) / 15_000) * 15_000;
    const window = (detail.session.heartbeat.dead_man_switch_seconds ?? 120) * 1000;
    detail.session.heartbeat = { ...detail.session.heartbeat, last_heartbeat_at: iso(last), expires_at: iso(last + window), lapsed_at: null };
  }
  detail.timeline = detail.timeline.filter((e) => !e.delivered_at || delivered(e.delivered_at, now));
  // Estado vigente de cada escalamiento (acuses y respuestas del demo).
  detail.escalations = detail.escalations.map((ref) => {
    const current = state.escalations.find((e) => e.id === ref.id);
    return current ? { ...ref, status: current.status === 'queued' ? 'delivered' : current.status } : ref;
  });
  const questions: EmergencyQuestion[] = state.messages
    .filter((m) => emergency.questionEscalations.includes(m.escalation_id))
    .filter((m) => m.direction === 'to_crew' || delivered(m.deliver_at, now))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((m) => ({
      id: m.id,
      session_id: detail.session.id,
      escalation_id: m.escalation_id,
      direction: m.direction,
      body: m.body,
      created_at: m.created_at,
      deliver_at: m.deliver_at ?? null,
    }));

  if (role !== 'admin') return { ...detail, questions };

  // admin: solo estado operativo (sin answers, categorías, preguntas, orden de atención ni reporte).
  const CLINICAL = new Set(['assessment_completed', 'device_mismatch', 'question_to_earth']);
  return {
    session: detail.session,
    assessments: detail.assessments.map((a) => ({
      id: a.id,
      client_uuid: a.client_uuid,
      session_id: a.session_id,
      astronaut_id: a.astronaut_id,
      call_sign: a.call_sign,
      assessed_by: a.assessed_by,
      is_self_assessment: a.is_self_assessment,
      sequence_no: a.sequence_no,
      status: a.status,
      started_at: a.started_at,
      completed_at: a.completed_at,
    })),
    escalations: detail.escalations,
    timeline: detail.timeline.map((e) => {
      if (!CLINICAL.has(e.event_type)) return e;
      const { details: _omit, ...rest } = e;
      void _omit;
      return rest;
    }),
    report: null,
  };
}

// ---------------------------------------------------------------- salud conductual

const SUPPORT_SUMMARY: Record<SupportRequest['channel'], string> = {
  message: 'Solicitud de apoyo por mensaje',
  session: 'Solicitud de sesión',
};

function behavioralRank(item: BehavioralInboxItem): number {
  if (item.kind === 'support_request') return item.urgency === 'now' ? 0 : item.urgency === 'today' ? 2 : 4;
  return item.priority === 'routine' ? 3 : 1;
}

const INBOX_RESOURCE = 'GET /api/v1/admin/behavioral/inbox';
const DETAIL_RESOURCE = 'GET /api/v1/admin/behavioral/astronauts/{id}';

/** Bitácora de accesos confidenciales (no repite la misma consulta en menos de 2 min). */
function logAccess(state: MockState, user: MockUser, astronautId: string, resource: string, now: number): void {
  const recent = state.audit.find(
    (a) =>
      a.actor_user_id === user.id &&
      a.astronaut_id === astronautId &&
      a.resource === resource &&
      now - new Date(a.accessed_at).getTime() < 120_000,
  );
  if (recent) return;
  state.audit.push({
    id: crypto.randomUUID(),
    actor_user_id: user.id,
    actor_username: user.username,
    actor_role: user.role,
    astronaut_id: astronautId,
    call_sign: astronautAccount(state, astronautId)?.astronaut?.call_sign,
    resource,
    accessed_at: iso(now),
  });
}

function supportRequest(state: MockState, id: string, now: number): MockSupportRequest {
  const request = state.supportRequests.find((r) => r.id === id);
  if (!request || !delivered(request.deliver_at, now)) {
    return notFound('La solicitud no existe o todavía no llega a Tierra.');
  }
  return request;
}

const publicSupport = (r: MockSupportRequest): SupportRequest => ({
  id: r.id,
  client_uuid: r.client_uuid,
  astronaut_id: r.astronaut_id,
  status: r.status,
  urgency: r.urgency,
  channel: r.channel,
  content: r.content,
  created_at: r.created_at,
  received_at: r.received_at,
  deliver_at: r.deliver_at ?? null,
});

function behavioralEscalation(state: MockState, id: string, now: number) {
  const escalation = state.behavioralEscalations.find((e) => e.id === id);
  if (!escalation || !delivered(escalation.deliver_at, now)) {
    return notFound('El escalamiento no existe o todavía no llega a Tierra.');
  }
  return escalation;
}

const closedItem = (item: { id: string; closed_at?: string | null; closed_by?: string | null }): ClosedItem => ({
  id: item.id,
  status: 'closed',
  closed_at: item.closed_at as string,
  closed_by: item.closed_by ?? null,
});

// ---------------------------------------------------------------- rutas

const ROUTES: Route[] = [
  ...ACCOUNT_ROUTES,
  {
    method: 'GET',
    pattern: '/health',
    roles: 'public',
    handle: ({ now }) => json(200, { status: 'ok', db: 'up', time: iso(now), version: '1.8.0-mock' }),
  },
  {
    method: 'GET',
    pattern: '/missions/current',
    roles: EVERYONE,
    handle: ({ query, state }) => {
      checkMission(query);
      return json(200, currentMission(state.t0));
    },
  },
  {
    method: 'GET',
    pattern: '/indicators',
    roles: EVERYONE,
    handle: ({ query }) => {
      const sensitivity = query.get('sensitivity');
      const items = sensitivity && sensitivity !== 'standard' ? [] : STANDARD_CATALOG;
      return json(200, { catalog_version: 1, rules_version: 1, items });
    },
  },
  // ------------------------------------------------------------ Tierra
  {
    method: 'GET',
    pattern: '/admin/dashboard/crew',
    roles: GROUND,
    handle: (ctx) => {
      checkMission(ctx.query);
      return json(200, crewDashboard(ctx.state.t0, ctx.now, me(ctx).role === 'admin'));
    },
  },
  {
    method: 'GET',
    pattern: '/admin/inbox',
    roles: GROUND,
    handle: (ctx) => {
      const { query, state, now } = ctx;
      checkMission(query);
      const category = query.get('category');
      const status = query.get('status');
      if (category && !['reading', 'emergency', 'wellbeing', 'manual'].includes(category)) {
        fail(400, 'VALIDATION_ERROR', 'category inválida.');
      }
      if (status && !['delivered', 'acknowledged', 'responded'].includes(status)) {
        fail(400, 'VALIDATION_ERROR', 'status inválido.');
      }
      const admin = me(ctx).role === 'admin';
      const items = state.escalations
        .filter((e) => delivered(e.deliver_at, now) && e.status !== 'closed')
        .map((e) => {
          // Al leer la bandeja, lo que ya llegó pasa de queued a delivered.
          if (e.status === 'queued') e.status = 'delivered';
          return e;
        })
        .filter((e) => !(admin && hiddenFromAdmin(e)))
        .filter((e) => !category || e.category === category)
        .filter((e) => !status || e.status === status)
        .sort(
          (a, b) =>
            PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
            a.deliver_at.localeCompare(b.deliver_at) ||
            a.id.localeCompare(b.id),
        )
        .map((e) => {
          const copy = structuredClone(e);
          if (admin) delete copy.triage;
          return copy;
        });
      return json(200, paginate(items, query));
    },
  },
  {
    method: 'POST',
    pattern: '/admin/escalations/:id/ack',
    roles: GROUND,
    handle: (ctx) => {
      const item = groundEscalation(ctx.state, ctx.params.id as string, ctx.now);
      guardGround(me(ctx), item);
      if (item.status === 'closed') conflict('El escalamiento está cerrado.');
      patchEscalation(ctx.state, item, {
        ...(item.status === 'delivered' || item.status === 'queued' ? { status: 'acknowledged' as const } : {}),
        ...ackFields(item, me(ctx), ctx.now),
      });
      const ack: EscalationAck = {
        id: item.id,
        status: item.status,
        acknowledged_at: item.acknowledged_at as string,
        acknowledged_by: item.acknowledged_by as string,
      };
      return json(200, ack);
    },
  },
  {
    method: 'GET',
    pattern: '/admin/escalations/:id/messages',
    roles: GROUND,
    handle: (ctx) => {
      const item = groundEscalation(ctx.state, ctx.params.id as string, ctx.now);
      guardGround(me(ctx), item);
      const items = ctx.state.messages
        .filter((m) => m.escalation_id === item.id)
        // Lo de Tierra sale siempre; lo de a bordo, solo cuando ya llegó.
        .filter((m) => m.direction === 'to_crew' || delivered(m.deliver_at, ctx.now))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      return json(200, paginate(items, ctx.query));
    },
  },
  {
    method: 'POST',
    pattern: '/admin/escalations/:id/messages',
    roles: GROUND,
    handle: (ctx) => {
      const user = me(ctx);
      const item = groundEscalation(ctx.state, ctx.params.id as string, ctx.now);
      guardGround(user, item);
      if (item.status === 'closed') conflict('El escalamiento está cerrado: ya no admite respuestas.');
      const message: EscalationMessage = {
        id: crypto.randomUUID(),
        escalation_id: item.id,
        direction: 'to_crew',
        author_id: user.id,
        author_role: user.role === 'admin' ? 'admin' : 'flight_surgeon',
        body: readBody(ctx.body),
        created_at: iso(ctx.now),
        deliver_at: iso(ctx.now + DELAY_S * 1000),
      };
      addMessage(ctx.state, message);
      patchEscalation(ctx.state, item, { ...ackFields(item, user, ctx.now), status: 'responded' });
      return json(201, message);
    },
  },
  {
    method: 'GET',
    pattern: '/admin/emergencies',
    roles: GROUND,
    handle: (ctx) => {
      const { query, state, now } = ctx;
      checkMission(query);
      const status = query.get('status');
      if (status && !['pending', 'active', 'closed', 'cancelled'].includes(status)) {
        fail(400, 'VALIDATION_ERROR', 'status inválido.');
      }
      const admin = me(ctx).role === 'admin';
      const items: EmergencyListItem[] = state.emergencies
        .filter((e) => delivered(firstDelivered(e), now))
        .filter((e) => !status || e.detail.session.status === status)
        .sort((a, b) => b.detail.session.started_at.localeCompare(a.detail.session.started_at))
        .map((e) => {
          const s = e.detail.session;
          return {
            id: s.id,
            mission_id: s.mission_id,
            mission_code: s.mission_code,
            trigger_type: s.trigger_type,
            status: s.status,
            started_at: s.started_at,
            closed_at: s.closed_at ?? null,
            received_at: s.received_at,
            first_delivered_at: firstDelivered(e) as string,
            counts: admin ? null : countsOf(e),
          };
        });
      return json(200, paginate(items, query));
    },
  },
  {
    method: 'GET',
    pattern: '/admin/emergencies/:id',
    roles: GROUND,
    handle: (ctx) => {
      const emergency = visibleEmergency(ctx.state, ctx.params.id as string, ctx.now);
      return json(200, emergencyView(ctx.state, emergency, me(ctx).role, ctx.now));
    },
  },
  // ------------------------------------------------------------ salud conductual
  {
    method: 'GET',
    pattern: '/admin/behavioral/inbox',
    roles: BEHAVIORAL,
    handle: (ctx) => {
      const { query, state, now } = ctx;
      checkMission(query);
      const includeClosed = query.get('include_closed') === 'true';
      const callSign = (id: string) => astronautAccount(state, id)?.astronaut?.call_sign ?? '—';
      const requests: BehavioralInboxItem[] = state.supportRequests
        .filter((r) => delivered(r.deliver_at, now) && (includeClosed || r.status !== 'closed'))
        .map((r) => ({
          id: r.id,
          astronaut_id: r.astronaut_id,
          call_sign: callSign(r.astronaut_id),
          kind: 'support_request',
          indicator_code: null,
          urgency: r.urgency,
          channel: r.channel,
          priority: null,
          status: r.status,
          summary: SUPPORT_SUMMARY[r.channel],
          created_at: r.created_at,
          measured_at: r.created_at,
          deliver_at: r.deliver_at ?? null,
        }));
      const alerts: BehavioralInboxItem[] = state.behavioralEscalations
        .filter((e) => delivered(e.deliver_at, now) && (includeClosed || e.status !== 'closed'))
        .map((e) => ({
          id: e.id,
          astronaut_id: e.astronaut_id,
          call_sign: callSign(e.astronaut_id),
          kind: e.kind,
          indicator_code: e.indicator_code,
          urgency: null,
          channel: null,
          priority: e.priority,
          status: e.status,
          summary: e.summary,
          created_at: e.created_at,
          measured_at: e.measured_at,
          deliver_at: e.deliver_at,
        }));
      const items = [...requests, ...alerts].sort(
        (a, b) =>
          behavioralRank(a) - behavioralRank(b) || (a.deliver_at ?? '').localeCompare(b.deliver_at ?? ''),
      );
      const page = paginate(items, query);
      for (const id of new Set(page.items.map((i) => i.astronaut_id))) {
        logAccess(state, me(ctx), id, INBOX_RESOURCE, now);
      }
      return json(200, page);
    },
  },
  {
    method: 'GET',
    pattern: '/admin/behavioral/astronauts/:id',
    roles: BEHAVIORAL,
    handle: (ctx) => {
      const { state, now } = ctx;
      const account = astronautAccount(state, ctx.params.id as string);
      const member = account?.astronaut;
      if (!account || !member) return notFound('El astronauta no existe o no es de tu misión.');
      logAccess(state, me(ctx), member.id, DETAIL_RESOURCE, now);
      const byRecent = <T extends { measured_at: string }>(list: T[]) =>
        [...list].sort((a, b) => b.measured_at.localeCompare(a.measured_at));
      // Un tripulante dado de alta en el demo todavía no tiene check-ins, tamizajes ni PVT.
      const fixture = !account.created_in_demo;
      return json(200, {
        astronaut: { id: member.id, call_sign: member.call_sign },
        generated_at: iso(now),
        baseline_ready: fixture,
        indicators: fixture ? buildIndicators(state.t0, member.call_sign) : [],
        // Sin la nota privada: en los datos del demo ni siquiera existe.
        checkins: fixture ? byRecent(buildCheckins(state.t0, member.call_sign)) : [],
        escalations: state.behavioralEscalations
          .filter((e) => e.astronaut_id === member.id && e.status !== 'closed' && delivered(e.deliver_at, now))
          .map((e) => ({
            id: e.id,
            indicator_code: e.indicator_code,
            status: e.status,
            priority: e.priority,
            created_at: e.created_at,
            deliver_at: e.deliver_at,
            measured_at: e.measured_at,
          })),
        screenings: fixture ? byRecent(buildScreenings(state.t0, member.call_sign)) : [],
        pvt_runs: fixture ? byRecent(buildPvtRuns(state.t0, member.call_sign)) : [],
        support_requests: state.supportRequests
          .filter((r) => r.astronaut_id === member.id && delivered(r.deliver_at, now))
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map(publicSupport),
      });
    },
  },
  {
    method: 'POST',
    pattern: '/admin/behavioral/support-requests/:id/messages',
    roles: BEHAVIORAL,
    handle: (ctx) => {
      const request = supportRequest(ctx.state, ctx.params.id as string, ctx.now);
      if (request.status === 'closed') conflict('La solicitud está cerrada: ya no admite respuestas.');
      const message: SupportMessage = {
        id: crypto.randomUUID(),
        request_id: request.id,
        direction: 'to_crew',
        author_role: 'behavioral_health',
        body: readBody(ctx.body),
        created_at: iso(ctx.now),
        deliver_at: iso(ctx.now + DELAY_S * 1000),
      };
      addSupportMessage(ctx.state, message);
      // Responder también cuenta como acuse.
      patchSupportRequest(ctx.state, request, {
        ...(request.status === 'open' ? { status: 'acknowledged' as const } : {}),
        ...ackFields(request, me(ctx), ctx.now),
      });
      return json(201, message);
    },
  },
  {
    method: 'POST',
    pattern: '/admin/behavioral/support-requests/:id/ack',
    roles: BEHAVIORAL,
    handle: (ctx) => {
      const request = supportRequest(ctx.state, ctx.params.id as string, ctx.now);
      if (request.status === 'closed') conflict('La solicitud está cerrada.');
      patchSupportRequest(ctx.state, request, { status: 'acknowledged', ...ackFields(request, me(ctx), ctx.now) });
      const ack: SupportRequestAck = {
        id: request.id,
        status: request.status,
        acknowledged_at: request.acknowledged_at as string,
        acknowledged_by: request.acknowledged_by ?? null,
      };
      return json(200, ack);
    },
  },
  {
    method: 'POST',
    pattern: '/admin/behavioral/support-requests/:id/close',
    roles: BEHAVIORAL,
    handle: (ctx) => {
      const request = supportRequest(ctx.state, ctx.params.id as string, ctx.now);
      if (request.status !== 'closed') {
        patchSupportRequest(ctx.state, request, { status: 'closed', closed_at: iso(ctx.now), closed_by: me(ctx).id });
      }
      return json(200, closedItem(request));
    },
  },
  {
    method: 'POST',
    pattern: '/admin/behavioral/escalations/:id/ack',
    roles: BEHAVIORAL,
    handle: (ctx) => {
      const escalation = behavioralEscalation(ctx.state, ctx.params.id as string, ctx.now);
      if (escalation.status === 'closed') conflict('El escalamiento está cerrado.');
      patchBehavioralEscalation(ctx.state, escalation, {
        ...(escalation.status === 'delivered' ? { status: 'acknowledged' as const } : {}),
        ...ackFields(escalation, me(ctx), ctx.now),
      });
      const ack: EscalationAck = {
        id: escalation.id,
        status: escalation.status,
        acknowledged_at: escalation.acknowledged_at as string,
        acknowledged_by: escalation.acknowledged_by as string,
      };
      return json(200, ack);
    },
  },
  {
    method: 'POST',
    pattern: '/admin/behavioral/escalations/:id/close',
    roles: BEHAVIORAL,
    handle: (ctx) => {
      const escalation = behavioralEscalation(ctx.state, ctx.params.id as string, ctx.now);
      if (escalation.status !== 'closed') {
        patchBehavioralEscalation(ctx.state, escalation, { status: 'closed', closed_at: iso(ctx.now), closed_by: me(ctx).id });
      }
      return json(200, closedItem(escalation));
    },
  },
  {
    method: 'GET',
    pattern: '/admin/audit/confidential-access',
    roles: BEHAVIORAL,
    handle: ({ query, state }) => {
      checkMission(query);
      const astronautId = query.get('astronaut_id');
      const from = query.get('from');
      const to = query.get('to');
      const items: ConfidentialAccess[] = state.audit
        .filter((a) => !astronautId || a.astronaut_id === astronautId)
        .filter((a) => !from || a.accessed_at >= from)
        .filter((a) => !to || a.accessed_at < to)
        .sort((a, b) => b.accessed_at.localeCompare(a.accessed_at));
      return json(200, paginate(items, query));
    },
  },
];

function match(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split('/');
  const got = path.split('/');
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i += 1) {
    const w = want[i] as string;
    const g = got[i] as string;
    if (w.startsWith(':')) params[w.slice(1)] = decodeURIComponent(g);
    else if (w !== g) return null;
  }
  return params;
}

// ---------------------------------------------------------------- entrada

export interface MockRequest {
  method: string;
  /** Ruta del contrato sin /api/v1, con su query string (p. ej. /admin/inbox?mission_id=…). */
  path: string;
  bearer: string | null;
  body?: unknown;
  /** Hash de las contraseñas del body (lo calcula handleMockRequestAsync). */
  secrets?: Secrets;
}

/** Rutas que no existen en el contrato v1.8 (solo modo demo). */
export const MOCK_ONLY_ROUTES = ROUTES.filter((r) => r.mockOnly).map((r) => `${r.method} ${r.pattern}`);

/**
 * Responde una petición como lo haría la API (síncrono y sin red; lo usan también las pruebas).
 * Las contraseñas necesitan hash (async): para el login y el cambio de contraseña con cuentas
 * que tienen contraseña, usa handleMockRequestAsync.
 */
export function handleMockRequest(request: MockRequest, now: number = Date.now()): Response {
  const [pathname = '', search = ''] = request.path.split('?');
  const method = request.method.toUpperCase();
  try {
    let found: { route: Route; params: Record<string, string> } | null = null;
    for (const route of ROUTES) {
      if (route.method !== method) continue;
      const params = match(route.pattern, pathname);
      if (params) {
        found = { route, params };
        break;
      }
    }
    if (!found) return notFound(`Ruta no encontrada en el modo demo: ${method} /api/v1${pathname}`);

    const state = getState(now);
    let user: MockUser | null = null;
    if (found.route.roles !== 'public') {
      user = userFromToken(state, request.bearer, ACCESS) ?? null;
      if (!user) return fail(401, 'UNAUTHENTICATED', 'Falta el token de acceso o no es válido.');
      if (!found.route.roles.includes(user.role)) return forbidden(found.route.roles);
    }
    const response = found.route.handle({
      method,
      query: new URLSearchParams(search),
      params: found.params,
      body: request.body,
      user,
      bearer: request.bearer,
      secrets: request.secrets ?? {},
      state,
      now,
    });
    // Lo que escribe el usuario sobrevive a recargar la página (persistence.ts).
    if (method !== 'GET') persistState(state);
    return response;
  } catch (err) {
    if (err instanceof MockHttpError) {
      return json(err.status, { error: { code: err.code, message: err.message, details: err.details } });
    }
    return json(500, { error: { code: 'INTERNAL_ERROR', message: 'Error del modo demo.', details: null } });
  }
}

/** Igual que handleMockRequest, con el hash de las contraseñas antes y después de la ruta. */
export async function handleMockRequestAsync(request: MockRequest, now: number = Date.now()): Promise<Response> {
  const state = getState(now);
  let secrets: Secrets;
  try {
    secrets = await prepareSecrets(state, request);
  } catch (err) {
    return json(500, { error: { code: 'INTERNAL_ERROR', message: (err as Error).message, details: null } });
  }
  const response = handleMockRequest({ ...request, secrets }, now);
  try {
    if (await settlePasswords(state)) persistState(state);
  } catch (err) {
    return json(500, { error: { code: 'INTERNAL_ERROR', message: (err as Error).message, details: null } });
  }
  return response;
}

/** Termina el trabajo async pendiente (hash de contraseñas temporales). Lo usan las pruebas. */
export async function settleMock(now: number = Date.now()): Promise<void> {
  const state = getState(now);
  if (await settlePasswords(state)) persistState(state);
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('La petición se canceló.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

/** Lo que usa src/api/http.ts en modo mock en lugar de fetch(). */
export async function mockTransport(
  path: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
): Promise<Response> {
  if (latencyMs > 0) await wait(latencyMs, init.signal);
  else if (init.signal.aborted) throw new DOMException('La petición se canceló.', 'AbortError');
  const authorization = init.headers.Authorization ?? '';
  return handleMockRequestAsync({
    method: init.method,
    path,
    bearer: authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null,
    body: init.body ? (JSON.parse(init.body) as unknown) : undefined,
  });
}
