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
  LoginResponse,
  Priority,
  Role,
  SupportMessage,
  SupportRequest,
  SupportRequestAck,
  TokenPair,
  TriageCounts,
  UserContext,
  UserSummary,
} from '../types.ts';
import {
  buildCheckins,
  buildIndicators,
  buildPvtRuns,
  buildScreenings,
  type MockSupportRequest,
} from './fixtures/behavioral.ts';
import type { MockEmergency } from './fixtures/emergencies.ts';
import { currentMission, DELAY_S, MISSION_ID, MISSION_REF, STANDARD_CATALOG } from './fixtures/mission.ts';
import {
  crewByAstronautId,
  userById,
  userByUsername,
  type MockCrewMember,
  type MockUser,
} from './fixtures/people.ts';
import { crewDashboard } from './fixtures/readings.ts';
import { getState, type MockState } from './state.ts';

export { resetMockState } from './state.ts';

// ---------------------------------------------------------------- configuración

let latencyMs = 150;

/** Latencia simulada (ms). Las pruebas la ponen en 0. */
export function configureMock(options: { latencyMs?: number }): void {
  if (options.latencyMs !== undefined) latencyMs = Math.max(0, options.latencyMs);
}

// ---------------------------------------------------------------- respuestas y errores

class MockHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
  }
}

const fail = (status: number, code: string, message: string, details: unknown = null): never => {
  throw new MockHttpError(status, code, message, details);
};

function json(status: number, body: unknown): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const forbidden = (roles: Role[]) =>
  fail(403, 'FORBIDDEN', 'Tu rol no tiene permiso para esta acción.', { required_roles: roles });
const notFound = (message = 'El recurso no existe.') => fail(404, 'NOT_FOUND', message);
const conflict = (message: string) => fail(409, 'CONFLICT', message);

// ---------------------------------------------------------------- tokens

const ACCESS = 'mock-at.';
const REFRESH = 'mock-rt.';
let tokenSeq = 0;

function tokensFor(user: MockUser): TokenPair {
  tokenSeq += 1;
  return {
    access_token: `${ACCESS}${user.id}.${tokenSeq}`,
    token_type: 'Bearer',
    expires_in: 900,
    refresh_token: `${REFRESH}${user.id}.${tokenSeq}`,
  };
}

function userFromToken(token: string | null | undefined, prefix: string): MockUser | undefined {
  if (!token || !token.startsWith(prefix)) return undefined;
  return userById(token.slice(prefix.length).split('.')[0] ?? '');
}

// ---------------------------------------------------------------- utilidades

const iso = (ms: number) => new Date(ms).toISOString();
const delivered = (deliverAt: string | null | undefined, now: number) =>
  !!deliverAt && new Date(deliverAt).getTime() <= now;

function paginate<T>(items: T[], query: URLSearchParams): { items: T[]; next_cursor: string | null } {
  const rawLimit = query.get('limit');
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    fail(400, 'VALIDATION_ERROR', 'limit debe ser un entero entre 1 y 200.');
  }
  const rawCursor = query.get('cursor');
  const offset = rawCursor === null ? 0 : Number(rawCursor);
  if (!Number.isInteger(offset) || offset < 0) fail(400, 'VALIDATION_ERROR', 'Cursor inválido.');
  const page = items.slice(offset, offset + limit);
  const next = offset + limit < items.length ? String(offset + limit) : null;
  return { items: page, next_cursor: next };
}

function checkMission(query: URLSearchParams): void {
  const missionId = query.get('mission_id');
  if (missionId && missionId !== MISSION_ID) notFound('La misión no existe o no es de tu equipo.');
}

function readBody(body: unknown): string {
  const text = (body as { body?: unknown } | undefined)?.body;
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 4000) {
    fail(400, 'VALIDATION_ERROR', 'body es obligatorio (1 a 4000 caracteres).', { field: 'body' });
  }
  return (text as string).trim();
}

function summary(user: MockUser): UserSummary {
  return { id: user.id, username: user.username, full_name: user.full_name, role: user.role, email: null };
}

function contextFor(user: MockUser): UserContext {
  if (user.role === 'astronaut') {
    const member = user as MockCrewMember;
    return {
      astronaut_id: member.astronaut_id,
      call_sign: member.call_sign,
      crew_role: member.crew_role,
      mission: MISSION_REF,
    };
  }
  return { astronaut_id: null, call_sign: null, crew_role: null, ground_missions: [MISSION_REF] };
}

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

function acknowledge(item: { status: string; acknowledged_at?: string | null; acknowledged_by?: string | null }, user: MockUser, now: number) {
  if (!item.acknowledged_at) {
    item.acknowledged_at = iso(now);
    item.acknowledged_by = user.id;
  }
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
    call_sign: crewByAstronautId(astronautId)?.call_sign,
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

interface Ctx {
  method: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: unknown;
  user: MockUser | null;
  state: MockState;
  now: number;
}

interface Route {
  method: string;
  pattern: string;
  /** x-roles del contrato; 'public' = sin sesión. */
  roles: Role[] | 'public';
  handle(ctx: Ctx): Response;
}

const GROUND: Role[] = ['flight_surgeon', 'admin'];
const BEHAVIORAL: Role[] = ['behavioral_health'];
const EVERYONE: Role[] = ['astronaut', 'flight_surgeon', 'behavioral_health', 'admin'];

const me = (ctx: Ctx) => ctx.user as MockUser;

const ROUTES: Route[] = [
  {
    method: 'GET',
    pattern: '/health',
    roles: 'public',
    handle: ({ now }) => json(200, { status: 'ok', db: 'up', time: iso(now), version: '1.8.0-mock' }),
  },
  {
    method: 'POST',
    pattern: '/auth/login',
    roles: 'public',
    handle: ({ body }) => {
      const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
      if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
        return fail(400, 'VALIDATION_ERROR', 'username y password son obligatorios.');
      }
      const user = userByUsername(username.trim().toLowerCase());
      if (!user) return fail(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.');
      const response: LoginResponse = {
        ...tokensFor(user),
        must_change_password: false,
        offline_unlock_until: null,
        user: summary(user),
        context: contextFor(user),
      };
      return json(200, response);
    },
  },
  {
    method: 'POST',
    pattern: '/auth/refresh',
    roles: 'public',
    handle: ({ body }) => {
      const user = userFromToken((body as { refresh_token?: string } | undefined)?.refresh_token, REFRESH);
      if (!user) return fail(401, 'UNAUTHENTICATED', 'El refresh token no es válido.');
      return json(200, tokensFor(user));
    },
  },
  { method: 'POST', pattern: '/auth/logout', roles: 'public', handle: () => json(204, undefined) },
  {
    method: 'GET',
    pattern: '/me',
    roles: EVERYONE,
    handle: (ctx) => json(200, { user: summary(me(ctx)), context: contextFor(me(ctx)) }),
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
      if (item.status === 'delivered' || item.status === 'queued') item.status = 'acknowledged';
      acknowledge(item, me(ctx), ctx.now);
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
      ctx.state.messages.push(message);
      acknowledge(item, user, ctx.now);
      item.status = 'responded';
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
      const callSign = (id: string) => crewByAstronautId(id)?.call_sign ?? '—';
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
      const member = crewByAstronautId(ctx.params.id as string);
      if (!member) return notFound('El astronauta no existe o no es de tu misión.');
      logAccess(state, me(ctx), member.astronaut_id, DETAIL_RESOURCE, now);
      const byRecent = <T extends { measured_at: string }>(list: T[]) =>
        [...list].sort((a, b) => b.measured_at.localeCompare(a.measured_at));
      return json(200, {
        astronaut: { id: member.astronaut_id, call_sign: member.call_sign },
        generated_at: iso(now),
        baseline_ready: true,
        indicators: buildIndicators(state.t0, member.call_sign),
        // Sin la nota privada: en los datos del demo ni siquiera existe.
        checkins: byRecent(buildCheckins(state.t0, member.call_sign)),
        escalations: state.behavioralEscalations
          .filter((e) => e.astronaut_id === member.astronaut_id && e.status !== 'closed' && delivered(e.deliver_at, now))
          .map((e) => ({
            id: e.id,
            indicator_code: e.indicator_code,
            status: e.status,
            priority: e.priority,
            created_at: e.created_at,
            deliver_at: e.deliver_at,
            measured_at: e.measured_at,
          })),
        screenings: byRecent(buildScreenings(state.t0, member.call_sign)),
        pvt_runs: byRecent(buildPvtRuns(state.t0, member.call_sign)),
        support_requests: state.supportRequests
          .filter((r) => r.astronaut_id === member.astronaut_id && delivered(r.deliver_at, now))
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
      ctx.state.supportMessages.push(message);
      // Responder también cuenta como acuse.
      if (request.status === 'open') request.status = 'acknowledged';
      acknowledge(request, me(ctx), ctx.now);
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
      request.status = 'acknowledged';
      acknowledge(request, me(ctx), ctx.now);
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
        request.status = 'closed';
        request.closed_at = iso(ctx.now);
        request.closed_by = me(ctx).id;
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
      if (escalation.status === 'delivered') escalation.status = 'acknowledged';
      acknowledge(escalation, me(ctx), ctx.now);
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
        escalation.status = 'closed';
        escalation.closed_at = iso(ctx.now);
        escalation.closed_by = me(ctx).id;
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
}

/** Responde una petición como lo haría la API (síncrono y sin red: lo usan también las pruebas). */
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
      user = userFromToken(request.bearer, ACCESS) ?? null;
      if (!user) return fail(401, 'UNAUTHENTICATED', 'Falta el token de acceso o no es válido.');
      if (!found.route.roles.includes(user.role)) return forbidden(found.route.roles);
    }
    return found.route.handle({
      method,
      query: new URLSearchParams(search),
      params: found.params,
      body: request.body,
      user,
      state,
      now,
    });
  } catch (err) {
    if (err instanceof MockHttpError) {
      return json(err.status, { error: { code: err.code, message: err.message, details: err.details } });
    }
    return json(500, { error: { code: 'INTERNAL_ERROR', message: 'Error del modo demo.', details: null } });
  }
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
  return handleMockRequest({
    method: init.method,
    path,
    bearer: authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null,
    body: init.body ? (JSON.parse(init.body) as unknown) : undefined,
  });
}
