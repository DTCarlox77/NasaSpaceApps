'use strict';

/**
 * Escalamientos y su hilo de mensajes.
 * - A Tierra (flight_surgeon, behavioral_health): status queued y deliver_at con
 *   compute_deliver_at (retraso del entorno + cortes; NULL = en cola esperando enlace).
 * - A bordo (crew): status delivered y deliver_at = now().
 * - Bandeja de Tierra: v_ground_inbox (solo flight_surgeon, sin confidenciales, ya entregado).
 *   La evaluación de la lectura se une por v_readings_standard, nunca por readings.
 */
const { pool } = require('../config/db');

const GROUND_LEVELS = ['flight_surgeon', 'behavioral_health'];

const ESCALATION_COLUMNS = `id, client_uuid, mission_id, astronaut_id, source_type, source_id, level,
  priority, status, reason, category, is_confidential, created_at, deliver_at, acknowledged_at,
  acknowledged_by, closed_at`;

// Orden de la bandeja: prioridad (emergency > urgent > routine) y luego deliver_at.
const PRIORITY_RANK = `CASE i.priority WHEN 'emergency' THEN 0 WHEN 'urgent' THEN 1 ELSE 2 END`;
// Lo que ya llegó pero sigue queued (aún no promovido) se muestra como delivered.
const INBOX_STATUS = `CASE WHEN i.status = 'queued' THEN 'delivered' ELSE i.status::text END`;

/**
 * Crea un escalamiento. Idempotente: por client_uuid si viene y, para lecturas y bienestar,
 * por (source_id, level). Devuelve { row, created }.
 */
async function insert(
  {
    clientUuid = null,
    missionId,
    astronautId = null,
    sourceType,
    sourceId = null,
    level,
    priority,
    reason,
    category,
    isConfidential = false,
  },
  db = pool,
) {
  const ground = GROUND_LEVELS.includes(level);
  const { rows } = await db.query(
    `INSERT INTO escalations (client_uuid, mission_id, astronaut_id, source_type, source_id, level,
                              priority, status, reason, deliver_at, category, is_confidential)
     VALUES ($1, $2::uuid, $3, $4, $5, $6::escalation_level, $7::escalation_priority,
             $8::escalation_status, $9,
             CASE WHEN $10::boolean THEN compute_deliver_at($2::uuid, now()) ELSE now() END,
             $11, $12)
     ON CONFLICT DO NOTHING
     RETURNING ${ESCALATION_COLUMNS}`,
    [
      clientUuid,
      missionId,
      astronautId,
      sourceType,
      sourceId,
      level,
      priority,
      ground ? 'queued' : 'delivered',
      reason,
      ground,
      category,
      isConfidential,
    ],
  );
  if (rows[0]) return { row: rows[0], created: true };

  // Ya existía: el mismo client_uuid o la misma lectura y destino.
  const existing = clientUuid
    ? await db.query(`SELECT ${ESCALATION_COLUMNS} FROM escalations WHERE client_uuid = $1`, [
        clientUuid,
      ])
    : await db.query(
        `SELECT ${ESCALATION_COLUMNS} FROM escalations
         WHERE source_type = $1 AND source_id = $2 AND level = $3::escalation_level`,
        [sourceType, sourceId, level],
      );
  return { row: existing.rows[0] || null, created: false };
}

async function findById(id, db = pool) {
  const { rows } = await db.query(
    `SELECT ${ESCALATION_COLUMNS}, (deliver_at IS NOT NULL AND deliver_at <= now()) AS delivered
     FROM escalations WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** Bloquea la fila para el acuse o la respuesta (FOR UPDATE). */
async function lockById(id, db) {
  const { rows } = await db.query(
    `SELECT ${ESCALATION_COLUMNS}, (deliver_at IS NOT NULL AND deliver_at <= now()) AS delivered
     FROM escalations WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] || null;
}

/** queued → delivered para lo que ya llegó (se llama al leer la bandeja). */
async function promoteDelivered(missionId, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE escalations SET status = 'delivered'
     WHERE mission_id = $1 AND status = 'queued' AND deliver_at <= now()`,
    [missionId],
  );
  return rowCount;
}

/**
 * Página de la bandeja de Tierra (v_ground_inbox). Filtros:
 *   categories: categorías de la BD permitidas por accessPolicy (physical|behavioral|emergency);
 *   sourceTypes: source_type del filtro `category` del contrato (null = todos);
 *   status: delivered|acknowledged|responded (null = todos).
 */
async function inboxPage({ missionId, categories, sourceTypes, status, after, limit }, db = pool) {
  const params = [missionId, categories, sourceTypes, status, limit + 1];
  let cursorSql = '';
  if (after) {
    params.push(after.r, after.d, after.id);
    cursorSql = `AND (${PRIORITY_RANK}, i.deliver_at, i.id) > ($6::int, $7::timestamptz, $8::uuid)`;
  }
  const { rows } = await db.query(
    `SELECT i.id, i.mission_id, i.mission_code, i.astronaut_id, i.call_sign, i.source_type,
            i.source_id, i.level, i.priority, ${INBOX_STATUS} AS status, i.reason, i.created_at,
            i.deliver_at, i.acknowledged_at, i.acknowledged_by,
            ${PRIORITY_RANK} AS priority_rank, i.deliver_at::text AS deliver_at_cursor,
            re.level AS ev_level, re.rule_index AS ev_rule_index,
            re.rules_version AS ev_rules_version, re.recommendation AS ev_recommendation,
            re.escalation AS ev_escalation, re.basis AS ev_basis, re.source_ids AS ev_source_ids,
            r.indicator_code AS ev_code,
            ea.triage_category, ea.radiation_flag
     FROM v_ground_inbox i
     LEFT JOIN v_readings_standard r ON i.source_type = 'reading' AND r.id = i.source_id
     LEFT JOIN reading_evaluations re ON re.reading_id = r.id
     LEFT JOIN emergency_assessments ea
       ON i.source_type = 'emergency_assessment' AND ea.id = i.source_id
     WHERE i.mission_id = $1
       AND i.category = ANY($2::text[])
       AND ($3::text[] IS NULL OR i.source_type = ANY($3::text[]))
       AND ($4::text IS NULL OR ${INBOX_STATUS} = $4::text)
       ${cursorSql}
     ORDER BY ${PRIORITY_RANK}, i.deliver_at, i.id
     LIMIT $5`,
    params,
  );
  return rows;
}

/** Acuse: queued/delivered → acknowledged. No retrocede un responded. */
async function acknowledge(id, userId, db = pool) {
  const { rows } = await db.query(
    `UPDATE escalations
     SET status = CASE WHEN status IN ('queued', 'delivered') THEN 'acknowledged' ELSE status END,
         acknowledged_by = CASE WHEN acknowledged_at IS NULL THEN $2 ELSE acknowledged_by END,
         acknowledged_at = COALESCE(acknowledged_at, now())
     WHERE id = $1
     RETURNING id, status, acknowledged_at, acknowledged_by`,
    [id, userId],
  );
  return rows[0] || null;
}

/** Respuesta de Tierra: pasa a responded (y cuenta como acuse si no lo había). */
async function markResponded(id, userId, db = pool) {
  await db.query(
    `UPDATE escalations
     SET status = 'responded',
         acknowledged_by = CASE WHEN acknowledged_at IS NULL THEN $2 ELSE acknowledged_by END,
         acknowledged_at = COALESCE(acknowledged_at, now())
     WHERE id = $1`,
    [id, userId],
  );
}

// ---------------------------------------------------------------- mensajes

const MESSAGE_COLUMNS = `m.id, m.escalation_id, m.direction, m.author_id, u.role::text AS author_role,
  m.body, m.created_at, m.deliver_at, m.created_at::text AS created_at_cursor`;

/** Mensaje que cruza el enlace: deliver_at = compute_deliver_at(misión, now()). */
async function insertMessage({ escalationId, missionId, direction, authorId, body }, db = pool) {
  const { rows } = await db.query(
    `WITH m AS (
       INSERT INTO escalation_messages (escalation_id, direction, author_id, body, deliver_at)
       VALUES ($1, $2::message_direction, $3, $4, compute_deliver_at($5::uuid, now()))
       RETURNING *)
     SELECT ${MESSAGE_COLUMNS} FROM m LEFT JOIN users u ON u.id = m.author_id`,
    [escalationId, direction, authorId, body, missionId],
  );
  return rows[0];
}

/**
 * Hilo visto a bordo: lo que viene de Tierra solo si ya llegó (deliver_at <= now());
 * lo que salió de a bordo (to_earth) siempre.
 */
async function crewThreadPage({ escalationId, after, limit }, db = pool) {
  const params = [escalationId, limit + 1];
  let cursorSql = '';
  if (after) {
    params.push(after.c, after.id);
    cursorSql = 'AND (m.created_at, m.id) > ($3::timestamptz, $4::uuid)';
  }
  const { rows } = await db.query(
    `SELECT ${MESSAGE_COLUMNS}
     FROM escalation_messages m LEFT JOIN users u ON u.id = m.author_id
     WHERE m.escalation_id = $1
       AND (m.direction = 'to_earth' OR m.deliver_at <= now())
       ${cursorSql}
     ORDER BY m.created_at, m.id
     LIMIT $2`,
    params,
  );
  return rows;
}

// ---------------------------------------------------------------- recálculo por cortes

/**
 * Recalcula deliver_at de todo lo que todavía no cruzó el enlace en la misión (en cola o
 * en camino) con compute_deliver_at(misión, hora de envío). Se llama al crear, corregir o
 * cerrar un corte. Devuelve cuántas filas cambiaron por tabla.
 */
async function recomputePending(missionId, db = pool) {
  const escalations = await db.query(
    `UPDATE escalations e
     SET deliver_at = compute_deliver_at(e.mission_id, e.created_at)
     WHERE e.mission_id = $1 AND e.status = 'queued'
       AND e.level IN ('flight_surgeon', 'behavioral_health')
       AND (e.deliver_at IS NULL OR e.deliver_at > now())
       AND e.deliver_at IS DISTINCT FROM compute_deliver_at(e.mission_id, e.created_at)`,
    [missionId],
  );
  const messages = await db.query(
    `UPDATE escalation_messages m
     SET deliver_at = compute_deliver_at(e.mission_id, m.created_at)
     FROM escalations e
     WHERE e.id = m.escalation_id AND e.mission_id = $1
       AND (m.deliver_at IS NULL OR m.deliver_at > now())
       AND m.deliver_at IS DISTINCT FROM compute_deliver_at(e.mission_id, m.created_at)`,
    [missionId],
  );
  // Bienestar ("Quiero hablar con alguien"): mismas reglas de enlace.
  const supportRequests = await db.query(
    `UPDATE support_requests s
     SET deliver_at = compute_deliver_at(s.mission_id, s.received_at)
     WHERE s.mission_id = $1 AND s.status <> 'closed'
       AND (s.deliver_at IS NULL OR s.deliver_at > now())
       AND s.deliver_at IS DISTINCT FROM compute_deliver_at(s.mission_id, s.received_at)`,
    [missionId],
  );
  const supportMessages = await db.query(
    `UPDATE support_messages sm
     SET deliver_at = compute_deliver_at(s.mission_id, sm.created_at)
     FROM support_requests s
     WHERE s.id = sm.request_id AND s.mission_id = $1
       AND (sm.deliver_at IS NULL OR sm.deliver_at > now())
       AND sm.deliver_at IS DISTINCT FROM compute_deliver_at(s.mission_id, sm.created_at)`,
    [missionId],
  );
  return {
    escalations: escalations.rowCount,
    escalation_messages: messages.rowCount,
    support_requests: supportRequests.rowCount,
    support_messages: supportMessages.rowCount,
  };
}

module.exports = {
  GROUND_LEVELS,
  insert,
  findById,
  lockById,
  promoteDelivered,
  inboxPage,
  acknowledge,
  markResponded,
  insertMessage,
  crewThreadPage,
  recomputePending,
};
