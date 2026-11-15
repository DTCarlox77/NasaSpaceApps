'use strict';

/**
 * "Quiero hablar con alguien" (CONFIDENCIAL): solicitudes de apoyo y su hilo con
 * behavioral_health. Solo las ven el propio astronauta y behavioral_health de su misión:
 * nunca la tripulación, el comandante, el oficial médico ni admin (ni en conteos).
 * Todo lo que cruza el enlace lleva deliver_at = compute_deliver_at(misión, envío); NULL = en
 * cola durante un corte (el recálculo por cortes ya cubre estas tablas, escalations.model).
 */
const { pool } = require('../config/db');

const REQUEST_COLUMNS = `s.id, s.client_uuid, s.astronaut_id, s.mission_id, s.urgency, s.channel,
  s.content, s.status, s.created_at, s.received_at, s.deliver_at, s.acknowledged_at,
  s.acknowledged_by, s.closed_at, s.closed_by,
  (s.deliver_at IS NOT NULL AND s.deliver_at <= now()) AS delivered`;

/** Crea la solicitud si no existe (idempotente por astronauta + client_uuid). */
async function insertRequest(
  { clientUuid, astronautId, missionId, urgency, channel, content, createdAt },
  db = pool,
) {
  const { rows } = await db.query(
    `WITH s AS (
       INSERT INTO support_requests (client_uuid, astronaut_id, mission_id, urgency, channel,
                                     content, created_at, deliver_at)
       VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, compute_deliver_at($3::uuid, now()))
       ON CONFLICT (astronaut_id, client_uuid) DO NOTHING
       RETURNING *)
     SELECT ${REQUEST_COLUMNS} FROM s`,
    [clientUuid, astronautId, missionId, urgency, channel, content, createdAt],
  );
  if (rows[0]) return { row: rows[0], created: true };
  return { row: await findByClientUuid(astronautId, clientUuid, db), created: false };
}

async function findByClientUuid(astronautId, clientUuid, db = pool) {
  const { rows } = await db.query(
    `SELECT ${REQUEST_COLUMNS} FROM support_requests s
     WHERE s.astronaut_id = $1 AND s.client_uuid = $2`,
    [astronautId, clientUuid],
  );
  return rows[0] || null;
}

async function findById(id, db = pool) {
  const { rows } = await db.query(
    `SELECT ${REQUEST_COLUMNS} FROM support_requests s WHERE s.id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** Bloquea la fila para el acuse, la respuesta o el cierre (FOR UPDATE). */
async function lockById(id, db) {
  const { rows } = await db.query(
    `SELECT ${REQUEST_COLUMNS} FROM support_requests s WHERE s.id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] || null;
}

/** open → acknowledged (idempotente; no toca una cerrada). */
async function acknowledge(id, userId, db = pool) {
  const { rows } = await db.query(
    `UPDATE support_requests
     SET status = CASE WHEN status = 'open' THEN 'acknowledged' ELSE status END,
         acknowledged_by = CASE WHEN acknowledged_at IS NULL THEN $2 ELSE acknowledged_by END,
         acknowledged_at = COALESCE(acknowledged_at, now())
     WHERE id = $1
     RETURNING id, status, acknowledged_at, acknowledged_by`,
    [id, userId],
  );
  return rows[0] || null;
}

/** Cierre (idempotente). */
async function close(id, userId, db = pool) {
  const { rows } = await db.query(
    `UPDATE support_requests
     SET status = 'closed',
         closed_by = CASE WHEN closed_at IS NULL THEN $2 ELSE closed_by END,
         closed_at = COALESCE(closed_at, now())
     WHERE id = $1
     RETURNING id, status, closed_at, closed_by`,
    [id, userId],
  );
  return rows[0] || null;
}

const MESSAGE_COLUMNS = `m.id, m.request_id, m.direction::text AS direction, m.author_role, m.body,
  m.created_at, m.deliver_at, m.created_at::text AS created_at_cursor`;

/** Respuesta de behavioral_health: viaja con deliver_at = compute_deliver_at(misión, now()). */
async function insertMessage({ requestId, missionId, authorId, body }, db = pool) {
  const { rows } = await db.query(
    `WITH m AS (
       INSERT INTO support_messages (request_id, direction, author_id, author_role, body, deliver_at)
       VALUES ($1, 'to_crew', $2, 'behavioral_health', $3, compute_deliver_at($4::uuid, now()))
       RETURNING *)
     SELECT ${MESSAGE_COLUMNS} FROM m`,
    [requestId, authorId, body, missionId],
  );
  return rows[0];
}

/**
 * Hilo visto por el astronauta: lo de Tierra (to_crew) solo si ya llegó (deliver_at <= now());
 * lo suyo (to_earth), siempre.
 */
async function crewThreadPage({ requestId, after, limit }, db = pool) {
  const params = [requestId, limit + 1];
  let cursorSql = '';
  if (after) {
    params.push(after.c, after.id);
    cursorSql = 'AND (m.created_at, m.id) > ($3::timestamptz, $4::uuid)';
  }
  const { rows } = await db.query(
    `SELECT ${MESSAGE_COLUMNS} FROM support_messages m
     WHERE m.request_id = $1
       AND (m.direction = 'to_earth' OR (m.deliver_at IS NOT NULL AND m.deliver_at <= now()))
       ${cursorSql}
     ORDER BY m.created_at, m.id
     LIMIT $2`,
    params,
  );
  return rows;
}

module.exports = {
  insertRequest,
  findByClientUuid,
  findById,
  lockById,
  acknowledge,
  close,
  insertMessage,
  crewThreadPage,
};
