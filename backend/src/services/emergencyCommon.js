'use strict';

/**
 * Piezas compartidas del modo emergencia: el ACTOR (usuario o dispositivo), los
 * escalamientos de categoría emergency, la línea de tiempo y las formas del contrato.
 *
 * Actor: los servicios reciben { kind: 'user', ... } (de loadActor) o, desde la tarea 11,
 * { kind: 'device', device_id, mission_id } (tableta registrada con X-Device-Credential, sin
 * sesión de usuario). Nada de req.user dentro de los servicios.
 */
const env = require('../config/env');
const { HttpError, forbidden, notFound, badRequest } = require('../utils/httpError');
const { isUuid } = require('../utils/validate');
const { derivedUuid } = require('../utils/derivedUuid');
const escalations = require('../models/escalations.model');
const model = require('../models/emergency.model');
const { loadActor } = require('./accessPolicy');

const GROUND_ROLES = ['flight_surgeon', 'admin'];

// ---------------------------------------------------------------- actor

async function userActor(userId) {
  const actor = await loadActor(userId);
  if (!actor) throw forbidden();
  return { kind: 'user', ...actor };
}

/**
 * Tableta sin sesión (X-Device-Credential, tarea 11): opera solo el triaje de su misión.
 * user_id null: la línea de tiempo la registra como actor_device (etiqueta de la tableta).
 */
function deviceActor({ deviceId, missionId, label }) {
  return {
    kind: 'device',
    device_id: deviceId,
    device_label: label || null,
    role: 'device',
    user_id: null,
    astronaut_id: null,
    crew_role: null,
    mission_ids: missionId ? [missionId] : [],
  };
}

const actorUserId = (actor) => (actor.kind === 'user' ? actor.user_id : null);
const actorDeviceId = (actor) => (actor.kind === 'device' ? actor.device_id : null);
const actorDevice = (actor) =>
  actor.kind === 'device' ? actor.device_label || actor.device_id : null;

/**
 * Tripulante (o tableta) de la misión: puede operar la emergencia a bordo. Una tableta de otra
 * misión no tiene credencial válida aquí: 401, igual que una credencial desconocida.
 */
function assertCrew(actor, missionId) {
  if (actor.kind === 'device' && !actor.mission_ids.includes(missionId)) {
    throw new HttpError(
      401,
      'INVALID_DEVICE_CREDENTIAL',
      'La credencial de la tableta no es válida.',
    );
  }
  const crewLike = actor.kind === 'device' || actor.role === 'astronaut';
  if (!crewLike || !actor.mission_ids.includes(missionId)) {
    throw new HttpError(403, 'FORBIDDEN', 'Solo la tripulación de la misión opera la emergencia.');
  }
}

function crewMission(actor) {
  if (actor.kind === 'device') {
    if (!actor.mission_ids.length) throw forbidden();
    return actor.mission_ids[0];
  }
  if (actor.role !== 'astronaut' || !actor.astronaut_id || !actor.mission_ids.length) {
    throw new HttpError(403, 'NO_ACTIVE_ASSIGNMENT', 'No tienes una asignación de misión vigente.');
  }
  return actor.mission_ids[0];
}

const isGround = (actor) => actor.kind === 'user' && GROUND_ROLES.includes(actor.role);
/** Solo el flight surgeon ve lo clínico de la emergencia; admin, solo el estado operativo. */
const seesClinical = (actor) => actor.kind === 'device' || actor.role !== 'admin';

function refParam(value, field = 'id') {
  if (!isUuid(value)) throw badRequest([{ field, issue: 'debe ser un UUID' }]);
  return value;
}

/** Sesión por id o client_uuid; una fusionada se resuelve a la principal. */
async function resolveSession(ref, db) {
  let session = await model.findSessionByRef(refParam(ref), db);
  if (!session) throw notFound('La sesión de emergencia no existe.');
  let guard = 0;
  while (session.merged_into && guard < 5) {
    session = await model.findSession(session.merged_into, db);
    guard += 1;
  }
  return session;
}

// ---------------------------------------------------------------- escalamientos y eventos

/**
 * Escalamientos de categoría emergency (idempotentes por client_uuid derivado de la fuente y
 * el motivo). crew → a bordo al instante; flight_surgeon → Tierra con compute_deliver_at
 * (cortes incluidos). self_care no se escala. El motivo nunca lleva datos clínicos: admin
 * ve el estado operativo en la bandeja; el detalle lo abre el flight surgeon.
 */
async function escalate(
  {
    session,
    kind,
    targets,
    reason,
    sourceType = 'emergency_session',
    sourceId = null,
    astronautId = null,
  },
  db,
) {
  const source = sourceId || session.id;
  const out = [];
  for (const { level, priority } of targets) {
    if (level === 'self_care') continue;
    const { row } = await escalations.insert(
      {
        clientUuid: derivedUuid('emergency-escalation', source, kind, level),
        missionId: session.mission_id,
        astronautId,
        sourceType,
        sourceId: source,
        level,
        priority,
        reason,
        category: 'emergency',
        isConfidential: false,
      },
      db,
    );
    if (row) out.push(row);
  }
  return out;
}

const ACTIVATION_TARGETS = [
  { level: 'crew', priority: 'emergency' },
  { level: 'flight_surgeon', priority: 'emergency' },
];

const TRIGGER_LABEL = {
  manual_button: 'botón manual',
  crew_event: 'aviso de un tripulante',
  critical_reading: 'lectura crítica',
  missed_checkin: 'sin respuesta a la alerta de check-in',
  environment_alarm: 'alarma del hábitat',
};

/** Sesión activa: avisa a bordo y a Tierra (una sola vez por sesión). */
async function escalateActivation(session, why, db) {
  return escalate(
    {
      session,
      kind: 'activated',
      targets: ACTIVATION_TARGETS,
      reason: `Emergencia activa en ${session.mission_code} (${TRIGGER_LABEL[session.trigger_type] || session.trigger_type}${why ? `; ${why}` : ''}).`,
    },
    db,
  );
}

const event = (session, type, fields = {}, db) =>
  model.insertEvent({ sessionId: session.id, type, ...fields }, db);

// ---------------------------------------------------------------- formas del contrato

function toSession(s, { deadman = [], merged = [], protocol = null } = {}) {
  const deadmanSeconds =
    protocol && protocol.definition ? protocol.definition.dead_man_switch_seconds || 120 : 120;
  const out = {
    id: s.id,
    client_uuid: s.client_uuid,
    mission_id: s.mission_id,
    mission_code: s.mission_code,
    protocol: { id: s.protocol_id, code: s.protocol_code, version: s.protocol_version },
    trigger_type: s.trigger_type,
    started_by: s.started_by,
    status: s.status,
    context: s.context || {},
    responder_safe: s.responder_safe,
    next_step: s.responder_safe === false ? 'secure_self' : 'start_assessments',
    started_at: s.started_at,
    activated_at: s.activated_at,
    closed_at: s.closed_at,
    received_at: s.received_at,
    merged_into: s.merged_into,
    synthetic: s.synthetic,
    deadman: deadman.map((d) => ({
      astronaut_id: d.astronaut_id,
      call_sign: d.call_sign,
      trigger_type: d.trigger_type,
      deadline_at: d.deadline_at,
      confirmed_at: d.confirmed_at,
      expired_at: d.expired_at,
      status: d.confirmed_at ? 'confirmed' : d.expired_at ? 'expired' : 'waiting',
    })),
    heartbeat: {
      dead_man_switch_seconds: deadmanSeconds,
      last_heartbeat_at: s.last_heartbeat_at,
      expires_at: s.last_heartbeat_at
        ? new Date(new Date(s.last_heartbeat_at).getTime() + deadmanSeconds * 1000).toISOString()
        : null,
      lapsed_at: s.heartbeat_lapsed_at,
    },
    joined_activations: merged.length,
  };
  return out;
}

function toAssessment(a, { answers, clinical = true } = {}) {
  const out = {
    id: a.id,
    client_uuid: a.client_uuid,
    session_id: a.session_id,
    astronaut_id: a.astronaut_id,
    call_sign: a.call_sign,
    assessed_by: a.assessed_by,
    is_self_assessment: a.is_self_assessment,
    sequence_no: a.sequence_no,
    status: a.status,
    reassessment_of: a.reassessment_of,
    started_at: a.started_at,
    completed_at: a.completed_at,
  };
  if (clinical) {
    out.triage_category = a.triage_category;
    out.radiation_flag = a.radiation_flag;
    out.computed_by = a.computed_by;
    out.rules_version = a.rules_version;
    out.matches_device = a.matches_device;
    out.device_result = a.device_result;
  }
  if (answers && clinical) {
    out.answers = answers.map((r) => ({
      question_code: r.question_code,
      answer: r.answer,
      source: r.source,
      source_reading_id: r.source_reading_id,
      answered_at: r.answered_at,
      received_at: r.received_at,
    }));
  }
  return out;
}

const toEscalationRef = (e) => ({
  id: e.id,
  level: e.level,
  priority: e.priority,
  status: e.status,
  deliver_at: e.deliver_at,
  source_type: e.source_type,
  source_id: e.source_id,
});

module.exports = {
  GROUND_ROLES,
  ACTIVATION_TARGETS,
  TRIGGER_LABEL,
  userActor,
  deviceActor,
  actorUserId,
  actorDeviceId,
  actorDevice,
  assertCrew,
  crewMission,
  isGround,
  seesClinical,
  refParam,
  resolveSession,
  escalate,
  escalateActivation,
  event,
  toSession,
  toAssessment,
  toEscalationRef,
  deadmanSeconds: () => env.triage.deadmanSeconds,
};
