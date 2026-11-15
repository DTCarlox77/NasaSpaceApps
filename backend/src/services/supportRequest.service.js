'use strict';

/**
 * "Quiero hablar con alguien" (tarea 10), CONFIDENCIAL.
 * - Astronauta: POST /wellbeing/support-requests (y entity support_request de /sync/push) y
 *   GET /wellbeing/support-requests/{id}/messages (lo de Tierra solo cuando ya llegó).
 * - behavioral_health: acuse, respuesta (viaja con deliver_at) y cierre, solo sobre lo que ya
 *   llegó a Tierra (si no, 404: Tierra todavía no sabe que existe).
 * Nunca lo ven la tripulación, el comandante, el oficial médico ni admin.
 *
 * Urgencia `now`: la respuesta trae sugerencias para la app (respiración guiada y hablar con
 * el oficial médico de a bordo). Son solo sugerencias: el servidor no avisa a nadie a bordo.
 */
const { badRequest, conflict, forbidden, notFound } = require('../utils/httpError');
const { isUuid, uuidParam, validate } = require('../utils/validate');
const {
  decodeCursor,
  limitIssue,
  parseLimit,
  toPage,
  isTimestampText,
} = require('../utils/pagination');
const { withTransaction } = require('../models/transaction');
const support = require('../models/support.model');
const { loadActor, canAccess, enforceAccess } = require('./accessPolicy');
const { measuredAtIssue } = require('./readingValidation');
const { ownActor } = require('./wellbeing.service');

const URGENCIES = ['later', 'today', 'now'];
const CHANNELS = ['message', 'session'];

/** Regla de diseño (sin fuente clínica): qué ofrece la app mientras llega la respuesta. */
const NOW_SUGGESTIONS = Object.freeze([
  Object.freeze({
    code: 'guided_breathing',
    title: 'Respiración guiada',
    description: 'Un ejercicio de respiración guiada en la app mientras llega la respuesta.',
  }),
  Object.freeze({
    code: 'talk_to_cmo',
    title: 'Hablar con el oficial médico de a bordo',
    description:
      'Si lo necesitas ahora, puedes buscar al oficial médico. Es tu decisión: nadie a bordo recibe un aviso automático.',
  }),
]);

const suggestionsFor = (urgency) =>
  urgency === 'now' ? NOW_SUGGESTIONS.map((s) => ({ ...s })) : [];

function toSupportRequest(row) {
  return {
    id: row.id,
    client_uuid: row.client_uuid,
    astronaut_id: row.astronaut_id,
    status: row.status,
    urgency: row.urgency,
    channel: row.channel,
    content: row.content,
    created_at: row.created_at,
    received_at: row.received_at,
    deliver_at: row.deliver_at,
  };
}

const toMessage = (row) => ({
  id: row.id,
  request_id: row.request_id,
  direction: row.direction,
  author_role: row.author_role,
  body: row.body,
  created_at: row.created_at,
  deliver_at: row.deliver_at,
});

function validateRequest(body, { prefix = '', clientUuid } = {}) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const problems = [];
  if (clientUuid === undefined && !isUuid(b.client_uuid)) {
    problems.push({ field: 'client_uuid', issue: 'debe ser un UUID' });
  }
  if (!URGENCIES.includes(b.urgency)) {
    problems.push({ field: `${prefix}urgency`, issue: `debe ser uno de: ${URGENCIES.join(', ')}` });
  }
  if (!CHANNELS.includes(b.channel)) {
    problems.push({ field: `${prefix}channel`, issue: `debe ser uno de: ${CHANNELS.join(', ')}` });
  }
  if (typeof b.content !== 'string' || !b.content.trim() || b.content.length > 2000) {
    problems.push({ field: `${prefix}content`, issue: 'debe tener entre 1 y 2000 caracteres' });
  }
  const whenIssue = measuredAtIssue(b.created_at);
  if (whenIssue) problems.push({ field: `${prefix}created_at`, issue: whenIssue });
  if (problems.length) throw badRequest(problems);
  return {
    client_uuid: clientUuid ?? b.client_uuid,
    urgency: b.urgency,
    channel: b.channel,
    content: b.content,
    created_at: b.created_at,
  };
}

const sameRequest = (row, input) =>
  row.urgency === input.urgency &&
  row.channel === input.channel &&
  row.content === input.content &&
  new Date(row.created_at).getTime() === new Date(input.created_at).getTime();

/**
 * Crea la solicitud (idempotente por client_uuid). strict = true (sync): el mismo client_uuid
 * con otro contenido es un conflicto PAYLOAD_MISMATCH (append-only); en línea, como el resto
 * del contrato, un duplicado responde 200 con el registro existente.
 */
async function createSupportRequest({ userId, body, clientUuid, prefix = '', strict = false }) {
  const input = validateRequest(body, { prefix, clientUuid });
  const actor = await ownActor(userId);
  await enforceAccess(actor, {
    astronaut_id: actor.astronaut_id,
    mission_id: actor.mission_ids[0],
    sensitivity: 'confidential',
    category: 'behavioral',
    action: 'write',
  });
  const { row, created } = await support.insertRequest({
    clientUuid: input.client_uuid,
    astronautId: actor.astronaut_id,
    missionId: actor.mission_ids[0],
    urgency: input.urgency,
    channel: input.channel,
    content: input.content,
    createdAt: input.created_at,
  });
  if (!created && strict && !sameRequest(row, input)) {
    throw conflict(
      'PAYLOAD_MISMATCH',
      'Ya existe una solicitud con ese client_uuid y otro contenido.',
      { server_id: row.id },
    );
  }
  return {
    status: created ? 201 : 200,
    body: { ...toSupportRequest(row), suggestions: suggestionsFor(row.urgency) },
  };
}

/** Solicitud propia del astronauta o 404 (no revela las de otros). */
async function ownRequest(actor, id) {
  const request = await support.findById(uuidParam(id));
  if (!request || request.astronaut_id !== actor.astronaut_id) {
    throw notFound('La solicitud no existe.');
  }
  return request;
}

/** GET /wellbeing/support-requests/{id}/messages (astronauta dueño). */
async function crewMessages({ userId, id, query }) {
  const limitProblem = limitIssue(query.limit);
  if (limitProblem) throw badRequest([{ field: 'limit', issue: limitProblem }]);
  const limit = parseLimit(query.limit);
  const after = decodeCursor(query.cursor, (c) => isTimestampText(c.c) && isUuid(c.id));
  const actor = await ownActor(userId);
  const request = await ownRequest(actor, id);
  const own = {
    astronaut_id: request.astronaut_id,
    mission_id: request.mission_id,
    sensitivity: 'confidential',
    category: 'behavioral',
    action: 'read',
  };
  if (!canAccess(actor, own)) throw forbidden();
  const rows = await support.crewThreadPage({ requestId: request.id, after, limit });
  return toPage(rows, limit, (r) => ({ c: r.created_at_cursor, id: r.id }), toMessage);
}

// ---------------------------------------------------------------- behavioral_health

const bhResource = (request, action) => ({
  astronaut_id: request.astronaut_id,
  mission_id: request.mission_id,
  sensitivity: 'confidential',
  category: 'behavioral',
  action,
});

/** Solicitud ya entregada en Tierra, de una misión del actor (bloqueada FOR UPDATE). */
async function lockDelivered(actor, id, db) {
  const request = await support.lockById(uuidParam(id), db);
  if (!request || !request.delivered) {
    throw notFound('La solicitud no existe o todavía no llegó a Tierra.');
  }
  await enforceAccess(actor, bhResource(request, 'write'), { db });
  return request;
}

async function bhActor(userId) {
  const actor = await loadActor(userId);
  if (!actor || actor.role !== 'behavioral_health') throw forbidden();
  return actor;
}

/** POST /admin/behavioral/support-requests/{id}/ack */
async function acknowledge({ userId, id }) {
  const actor = await bhActor(userId);
  return withTransaction(async (db) => {
    const request = await lockDelivered(actor, id, db);
    if (request.status === 'closed') {
      throw conflict('CONFLICT', 'La solicitud ya está cerrada.', { status: request.status });
    }
    return support.acknowledge(request.id, userId, db);
  });
}

/** POST /admin/behavioral/support-requests/{id}/messages: viaja con retraso; cuenta como acuse. */
async function reply({ userId, id, body }) {
  const input = validate(body).string('body', { max: 4000 }).check();
  if (!input.body.trim()) throw badRequest([{ field: 'body', issue: 'no puede estar vacío' }]);
  const actor = await bhActor(userId);
  return withTransaction(async (db) => {
    const request = await lockDelivered(actor, id, db);
    if (request.status === 'closed') {
      throw conflict('CONFLICT', 'La solicitud ya está cerrada.', { status: request.status });
    }
    const message = await support.insertMessage(
      { requestId: request.id, missionId: request.mission_id, authorId: userId, body: input.body },
      db,
    );
    await support.acknowledge(request.id, userId, db);
    return toMessage(message);
  });
}

/** POST /admin/behavioral/support-requests/{id}/close (idempotente). */
async function close({ userId, id }) {
  const actor = await bhActor(userId);
  return withTransaction(async (db) => {
    const request = await lockDelivered(actor, id, db);
    return support.close(request.id, userId, db);
  });
}

module.exports = {
  createSupportRequest,
  crewMessages,
  acknowledge,
  reply,
  close,
  toSupportRequest,
  suggestionsFor,
  NOW_SUGGESTIONS,
  URGENCIES,
};
