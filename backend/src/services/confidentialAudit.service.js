'use strict';

/**
 * Auditoría de accesos a datos confidenciales (confidential_access_log): quién vio datos de
 * bienestar, de quién y cuándo; nunca el contenido ni la IP.
 *
 * Quién la ve (decisión de la tarea 11): saber de quién consultó salud conductual ya revela algo
 * conductual, así que NO admin ni el flight surgeon.
 * - behavioral_health: los accesos sobre los astronautas de su misión (su propia auditoría).
 * - El astronauta: solo los accesos a SUS datos (quién vio lo suyo y cuándo).
 * Leer la auditoría no se registra en la bitácora (son metadatos, no datos de bienestar).
 */
const { HttpError, badRequest, forbidden } = require('../utils/httpError');
const { isUuid, uuidParam } = require('../utils/validate');
const {
  decodeCursor,
  limitIssue,
  parseLimit,
  toPage,
  isTimestampText,
} = require('../utils/pagination');
const audit = require('../models/confidentialAccess.model');
const { loadActor, canAccess } = require('./accessPolicy');
const { resolveMission } = require('./missionScope');

function parseQuery(query) {
  const problems = [];
  for (const field of ['from', 'to']) {
    if (query[field] !== undefined && Number.isNaN(Date.parse(query[field]))) {
      problems.push({ field, issue: 'debe ser una fecha ISO 8601' });
    }
  }
  const issue = limitIssue(query.limit);
  if (issue) problems.push({ field: 'limit', issue });
  if (problems.length) throw badRequest(problems);
  return {
    from: query.from ? new Date(query.from).toISOString() : null,
    to: query.to ? new Date(query.to).toISOString() : null,
    limit: parseLimit(query.limit),
    after: decodeCursor(query.cursor, (c) => isTimestampText(c.t) && isUuid(c.id)),
  };
}

const toItem = (row) => ({
  id: row.id,
  actor_user_id: row.actor_user_id,
  actor_username: row.actor_username,
  actor_role: row.actor_role,
  astronaut_id: row.astronaut_id,
  call_sign: row.call_sign,
  resource: row.resource,
  accessed_at: row.accessed_at,
});

const pageOf = (rows, limit) => toPage(rows, limit, (r) => ({ t: r.at_text, id: r.id }), toItem);

/** GET /admin/audit/confidential-access (behavioral_health de la misión). */
async function forBehavioralHealth({ userId, query }) {
  const range = parseQuery(query);
  const actor = await loadActor(userId);
  if (!actor || actor.role !== 'behavioral_health') throw forbidden();
  const mission = await resolveMission(actor, query.mission_id);
  const resource = {
    astronaut_id: '*',
    mission_id: mission.id,
    sensitivity: 'confidential',
    category: 'behavioral',
    action: 'read',
  };
  if (!canAccess(actor, resource))
    throw forbidden(null, 'No eres parte del equipo de esta misión.');
  const astronautId =
    query.astronaut_id === undefined ? null : uuidParam(query.astronaut_id, 'astronaut_id');
  const rows = await audit.page({ missionId: mission.id, astronautId, ...range });
  return pageOf(rows, range.limit);
}

/** GET /me/confidential-access (el astronauta: quién vio sus datos). */
async function forOwner({ userId, query }) {
  const range = parseQuery(query);
  const actor = await loadActor(userId);
  if (!actor || actor.role !== 'astronaut' || !actor.astronaut_id) {
    throw new HttpError(403, 'FORBIDDEN', 'Solo el astronauta ve quién consultó sus datos.');
  }
  const rows = await audit.page({ astronautId: actor.astronaut_id, ...range });
  return pageOf(rows, range.limit);
}

module.exports = { forBehavioralHealth, forOwner };
