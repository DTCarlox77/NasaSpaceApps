'use strict';

/**
 * Bandeja de Tierra, acuse y mensajes con retraso (tarea 6).
 * - GET /admin/inbox: v_ground_inbox (flight_surgeon, sin confidenciales, deliver_at <= now()).
 *   Las categorías visibles las decide accessPolicy: admin no ve las alertas de bienestar
 *   (behavioral); el flight surgeon solo su estado (view escalated_alert).
 * - POST /admin/escalations/{id}/ack y /messages: solo sobre lo que ya llegó a Tierra
 *   (si no, 404: el panel todavía no sabe que existe). La respuesta viaja con deliver_at.
 * - GET /escalations/{id}/messages: lado astronauta; lo de Tierra solo si ya llegó.
 */
const env = require('../config/env');
const { badRequest, notFound, conflict, forbidden } = require('../utils/httpError');
const { isUuid, uuidParam, validate } = require('../utils/validate');
const {
  decodeCursor,
  limitIssue,
  parseLimit,
  toPage,
  isTimestampText,
} = require('../utils/pagination');
const { withTransaction } = require('../models/transaction');
const escalations = require('../models/escalations.model');
const { loadActor, canAccess, enforceAccess } = require('./accessPolicy');
const { resolveMission } = require('./missionScope');
const delivery = require('./escalationDelivery.service');

// Filtro `category` del contrato → source_type de la BD.
const CONTRACT_CATEGORY_SOURCES = {
  reading: ['reading'],
  emergency: ['emergency_assessment', 'emergency_session'],
  wellbeing: ['wellbeing'],
  manual: ['manual'],
};
const SOURCE_TO_CONTRACT = {
  reading: 'reading',
  emergency_assessment: 'emergency',
  emergency_session: 'emergency',
  wellbeing: 'wellbeing',
  manual: 'manual',
};
const INBOX_STATUSES = ['delivered', 'acknowledged', 'responded'];
const DB_CATEGORIES = ['physical', 'emergency', 'behavioral'];

/** Recurso de accessPolicy para un escalamiento visto desde Tierra (solo estado). */
const groundResource = (esc) => ({
  astronaut_id: esc.astronaut_id ?? null,
  mission_id: esc.mission_id,
  sensitivity: esc.is_confidential ? 'confidential' : 'standard',
  category: esc.category,
  action: 'read',
  view:
    esc.category === 'behavioral'
      ? 'escalated_alert'
      : esc.category === 'emergency'
        ? 'operational'
        : 'detail',
});

/** Categorías de la BD que el actor puede ver en la bandeja de la misión. */
function visibleCategories(actor, missionId) {
  return DB_CATEGORIES.filter((category) =>
    // astronaut_id representativo ("un tripulante"): la bandeja nunca es de un solo astronauta.
    canAccess(
      actor,
      groundResource({
        astronaut_id: '*',
        mission_id: missionId,
        category,
        is_confidential: false,
      }),
    ),
  );
}

async function groundActor(userId) {
  const actor = await loadActor(userId);
  if (!actor) throw forbidden();
  return actor;
}

// ---------------------------------------------------------------- formas del contrato

function toInboxItem(row) {
  const item = {
    id: row.id,
    mission_id: row.mission_id,
    mission_code: row.mission_code,
    astronaut_id: row.astronaut_id,
    call_sign: row.call_sign,
    category: SOURCE_TO_CONTRACT[row.source_type],
    source_type: row.source_type,
    source_id: row.source_id,
    level: row.level,
    priority: row.priority,
    status: row.status,
    reason: row.reason,
    created_at: row.created_at,
    deliver_at: row.deliver_at,
    acknowledged_at: row.acknowledged_at,
    acknowledged_by: row.acknowledged_by,
  };
  if (row.r_measured_at) {
    // Para "registrado hace X h": una lectura que llegó tarde (p. ej. por /sync/push) escala
    // desde la recepción, pero el panel ve cuándo se midió.
    const lag = Math.max(
      0,
      Math.round((new Date(row.r_received_at) - new Date(row.r_measured_at)) / 1000),
    );
    item.measured_at = row.r_measured_at;
    item.late_sync = lag > env.sync.lateAfterS;
    item.lag_s = lag;
  }
  if (row.ev_level) {
    item.evaluation = { code: row.ev_code, level: row.ev_level, rule_index: row.ev_rule_index };
    if (row.ev_rules_version != null) item.evaluation.rules_version = row.ev_rules_version;
    if (row.ev_recommendation != null) item.evaluation.recommendation = row.ev_recommendation;
    item.evaluation.escalation = row.ev_escalation;
    if (row.ev_basis != null) item.evaluation.basis = row.ev_basis;
    if (row.ev_source_ids) item.evaluation.source_ids = row.ev_source_ids;
  }
  if (row.triage_category) {
    item.triage = { triage_category: row.triage_category };
    if (row.radiation_flag) item.triage.radiation_flag = row.radiation_flag;
  }
  return item;
}

const toMessage = (row) => ({
  id: row.id,
  escalation_id: row.escalation_id,
  direction: row.direction,
  author_id: row.author_id,
  author_role: row.author_role ?? undefined,
  body: row.body,
  created_at: row.created_at,
  deliver_at: row.deliver_at,
});

// ---------------------------------------------------------------- bandeja

async function inbox({ userId, query }) {
  const problems = [];
  if (query.category !== undefined && !CONTRACT_CATEGORY_SOURCES[query.category]) {
    problems.push({
      field: 'category',
      issue: `debe ser uno de: ${Object.keys(CONTRACT_CATEGORY_SOURCES).join(', ')}`,
    });
  }
  if (query.status !== undefined && !INBOX_STATUSES.includes(query.status)) {
    problems.push({ field: 'status', issue: `debe ser uno de: ${INBOX_STATUSES.join(', ')}` });
  }
  const limitProblem = limitIssue(query.limit);
  if (limitProblem) problems.push({ field: 'limit', issue: limitProblem });
  if (problems.length) throw badRequest(problems);
  const limit = parseLimit(query.limit);
  const after = decodeCursor(
    query.cursor,
    (c) => Number.isInteger(c.r) && isTimestampText(c.d) && isUuid(c.id),
  );

  const actor = await groundActor(userId);
  const mission = await resolveMission(actor, query.mission_id);
  const categories = visibleCategories(actor, mission.id);
  if (!categories.length) throw forbidden(null, 'No tienes permiso para ver esta bandeja.');

  // Plazos vencidos del hombre muerto (la instancia pudo dormirse): antes de leer la bandeja.
  await require('./emergency.service').runTriageSweep();
  await delivery.promoteDelivered(mission.id);
  const rows = await escalations.inboxPage({
    missionId: mission.id,
    categories,
    sourceTypes: query.category ? CONTRACT_CATEGORY_SOURCES[query.category] : null,
    status: query.status || null,
    after,
    limit,
  });
  // De una emergencia, admin solo ve el estado operativo: sin la clasificación del triaje.
  const clinicalEmergency = canAccess(actor, {
    astronaut_id: '*',
    mission_id: mission.id,
    sensitivity: 'standard',
    category: 'emergency',
    action: 'read',
    view: 'detail',
  });
  return toPage(
    rows,
    limit,
    (r) => ({ r: r.priority_rank, d: r.deliver_at_cursor, id: r.id }),
    (r) => {
      const item = toInboxItem(r);
      if (!clinicalEmergency) delete item.triage;
      return item;
    },
  );
}

// ---------------------------------------------------------------- acuse y respuesta

/** Escalamiento visible en la bandeja (bloqueado FOR UPDATE) o 404 / 403 / 409. */
async function lockGroundEscalation(actor, id, db) {
  const esc = await escalations.lockById(uuidParam(id), db);
  const inInbox = esc && esc.level === 'flight_surgeon' && !esc.is_confidential && esc.delivered;
  if (!inInbox) throw notFound('El escalamiento no existe o todavía no llegó a Tierra.');
  await enforceAccess(actor, groundResource(esc), { db });
  if (esc.status === 'closed') {
    throw conflict('CONFLICT', 'El escalamiento ya está cerrado.', { status: esc.status });
  }
  return esc;
}

async function acknowledge({ userId, id }) {
  const actor = await groundActor(userId);
  return withTransaction(async (db) => {
    await lockGroundEscalation(actor, id, db);
    return escalations.acknowledge(id, userId, db);
  });
}

async function reply({ userId, id, body }) {
  const input = validate(body).string('body', { max: 4000 }).check();
  if (!input.body.trim()) throw badRequest([{ field: 'body', issue: 'no puede estar vacío' }]);
  const actor = await groundActor(userId);
  return withTransaction(async (db) => {
    const esc = await lockGroundEscalation(actor, id, db);
    const message = await escalations.insertMessage(
      {
        escalationId: esc.id,
        missionId: esc.mission_id,
        direction: 'to_crew',
        authorId: userId,
        body: input.body,
      },
      db,
    );
    await escalations.markResponded(esc.id, userId, db);
    return toMessage(message);
  });
}

// ---------------------------------------------------------------- lado astronauta

async function crewMessages({ userId, id, query }) {
  const escalationId = uuidParam(id);
  const limitProblem = limitIssue(query.limit);
  if (limitProblem) throw badRequest([{ field: 'limit', issue: limitProblem }]);
  const limit = parseLimit(query.limit);
  const after = decodeCursor(query.cursor, (c) => isTimestampText(c.c) && isUuid(c.id));

  const actor = await loadActor(userId);
  const esc = await escalations.findById(escalationId);
  if (!esc) throw notFound('El escalamiento no existe.');
  await enforceAccess(actor, {
    astronaut_id: esc.astronaut_id ?? null,
    mission_id: esc.mission_id,
    sensitivity: esc.is_confidential ? 'confidential' : 'standard',
    category: esc.category,
    action: 'read',
  });
  const rows = await escalations.crewThreadPage({ escalationId, after, limit });
  return toPage(rows, limit, (r) => ({ c: r.created_at_cursor, id: r.id }), toMessage);
}

module.exports = { inbox, acknowledge, reply, crewMessages, visibleCategories };
