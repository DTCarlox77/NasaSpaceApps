'use strict';

/**
 * Panel de Tierra del modo emergencia (tarea 9): GET /admin/emergencies y /{id}.
 *
 * - Una sesión aparece cuando alguno de sus escalamientos a flight_surgeon ya llegó
 *   (deliver_at <= now()); lo de a bordo que todavía viaja no se ve (retraso + cortes).
 * - flight_surgeon: detalle clínico de lo que ya llegó (evaluaciones con respuestas,
 *   clasificación, orden de atención, línea de tiempo, preguntas) y el REPORTE completo
 *   cuando llega el evento de cierre.
 * - admin: solo el estado operativo (sesión, tripulantes y estado de cada evaluación,
 *   eventos no clínicos sin detalle, escalamientos). Nunca categorías ni respuestas.
 * - El acuse y la respuesta usan los endpoints de la bandeja (POST /admin/escalations/{id}/ack
 *   y /messages): la respuesta llega a bordo por /sync/pull cuando su deliver_at ya pasó.
 */
const { HttpError, badRequest, notFound } = require('../utils/httpError');
const {
  decodeCursor,
  encodeCursor,
  limitIssue,
  parseLimit,
  isTimestampText,
} = require('../utils/pagination');
const { isUuid } = require('../utils/validate');
const model = require('../models/emergency.model');
const { resolveMission } = require('./missionScope');
const view = require('./triageView');
const C = require('./emergencyCommon');
const { runTriageSweep, triageCounts } = require('./emergency.service');

const STATUSES = ['pending', 'active', 'closed', 'cancelled'];

function assertGround(actor, missionId) {
  if (!C.isGround(actor)) throw new HttpError(403, 'FORBIDDEN', 'Solo el panel de Tierra.');
  if (actor.role !== 'admin' && !actor.mission_ids.includes(missionId)) {
    throw new HttpError(403, 'FORBIDDEN', 'No eres parte del equipo en Tierra de esta misión.');
  }
}

/** Lo que ya llegó a Tierra de cada evaluación (por sus eventos entregados). */
async function deliveredState(sessionId) {
  const events = await model.eventsFor(sessionId, { delivered: true });
  const started = new Set();
  const completed = new Set();
  for (const e of events) {
    if (e.event_type === 'assessment_started') started.add(e.assessment_id);
    if (e.event_type === 'assessment_completed') completed.add(e.assessment_id);
  }
  return { events, started, completed };
}

function deliveredAssessments(all, state) {
  return all
    .filter((a) => state.started.has(a.id) || state.completed.has(a.id))
    .map((a) =>
      state.completed.has(a.id)
        ? a
        : {
            ...a,
            status: 'in_progress',
            completed_at: null,
            triage_category: null,
            radiation_flag: null,
          },
    );
}

async function list({ actor, query }) {
  await runTriageSweep();
  const problems = [];
  if (query.status !== undefined && !STATUSES.includes(query.status)) {
    problems.push({ field: 'status', issue: `debe ser uno de: ${STATUSES.join(', ')}` });
  }
  const issue = limitIssue(query.limit);
  if (issue) problems.push({ field: 'limit', issue });
  if (problems.length) throw badRequest(problems);
  const after = decodeCursor(query.cursor, (v) => isTimestampText(v.s) && isUuid(v.id));
  const limit = parseLimit(query.limit);
  const mission = await resolveMission(actor, query.mission_id);
  assertGround(actor, mission.id);

  const rows = await model.groundPage({
    missionId: mission.id,
    status: query.status,
    after,
    limit,
  });
  const page = rows.slice(0, limit);
  const items = [];
  for (const r of page) {
    let counts = null;
    if (C.seesClinical(actor)) {
      const state = await deliveredState(r.id);
      counts = triageCounts(deliveredAssessments(await model.assessmentsFor(r.id), state));
    }
    items.push({
      id: r.id,
      mission_id: r.mission_id,
      mission_code: r.mission_code,
      trigger_type: r.trigger_type,
      status: r.status,
      started_at: r.started_at,
      closed_at: r.closed_at,
      received_at: r.received_at,
      first_delivered_at: r.first_delivered_at,
      counts,
    });
  }
  const last = page[page.length - 1];
  return {
    items,
    next_cursor:
      rows.length > limit ? encodeCursor({ s: last.started_at_cursor, id: last.id }) : null,
  };
}

const OPERATIONAL_EVENTS = new Set([
  'opened',
  'joined',
  'merged',
  'deadman_started',
  'deadman_confirmed',
  'deadman_expired',
  'activated',
  'cancelled',
  'assessment_started',
  'assessment_completed',
  'heartbeat_lost',
  'question_to_earth',
  'closed',
]);

function toTimelineEvent(e, clinical) {
  const out = {
    id: e.id,
    event_type: e.event_type,
    at: e.created_at,
    device_at: e.device_at,
    delivered_at: e.deliver_at,
    astronaut_id: e.astronaut_id,
    call_sign: e.call_sign,
    actor_role: e.actor_role,
    assessment_id: e.assessment_id,
  };
  if (clinical || !e.clinical) out.details = e.details;
  return out;
}

async function detail({ actor, id }) {
  await runTriageSweep();
  if (!isUuid(id)) throw badRequest([{ field: 'id', issue: 'debe ser un UUID' }]);
  const session = await C.resolveSession(id);
  assertGround(actor, session.mission_id);
  const escalationRows = await model.sessionEscalations(session.id, { groundDelivered: true });
  if (!escalationRows.length) throw notFound('La sesión de emergencia todavía no llegó a Tierra.');

  const clinical = C.seesClinical(actor);
  const [protocol, deadman, merged, crew, allAssessments, state] = await Promise.all([
    model.protocolById(session.protocol_id),
    model.deadmanFor(session.id),
    model.mergedInto(session.id),
    model.crewOfMission(session.mission_id),
    model.assessmentsFor(session.id),
    deliveredState(session.id),
  ]);
  const assessments = deliveredAssessments(allAssessments, state);
  const out = {
    session: C.toSession(session, { deadman, merged, protocol }),
    assessments: [],
    escalations: escalationRows.map(C.toEscalationRef),
    timeline: state.events
      .filter((e) => clinical || OPERATIONAL_EVENTS.has(e.event_type))
      .map((e) => toTimelineEvent(e, clinical)),
    report: null,
  };
  for (const a of assessments) {
    const answers = clinical && state.completed.has(a.id) ? await model.answersFor(a.id) : [];
    out.assessments.push(C.toAssessment(a, { answers: clinical ? answers : undefined, clinical }));
  }
  if (clinical) {
    out.attention_order = view.attentionOrder({ crew, assessments, protocol: protocol.definition });
    out.questions = (await model.sessionMessages(session.id, { delivered: true })).map((m) => ({
      id: m.id,
      escalation_id: m.escalation_id,
      direction: m.direction,
      author_role: m.author_role,
      body: m.body,
      created_at: m.created_at,
      deliver_at: m.deliver_at,
    }));
    // El reporte llega con el evento de cierre (retraso + cortes).
    if (state.events.some((e) => e.event_type === 'closed')) {
      const report = await model.reportFor(session.id);
      out.report = report ? report.report : null;
    }
  } else {
    out.session.context = {};
    out.session.deadman = out.session.deadman.map(({ astronaut_id, call_sign, status }) => ({
      astronaut_id,
      call_sign,
      status,
    }));
  }
  return out;
}

module.exports = { list, detail };
