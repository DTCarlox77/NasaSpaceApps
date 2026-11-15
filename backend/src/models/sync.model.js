'use strict';

/**
 * Sincronización offline (tarea 8): historial de lotes (sync_batches, sync_items) y las
 * consultas de GET /sync/pull. Las escrituras de datos (lecturas, bienestar) NO pasan por
 * aquí: van por sus servicios. De cada item solo se guarda el SHA-256 del payload.
 *
 * Pull: cada flujo se lee por keyset (marca de tiempo, id) y solo hasta `horizon`
 * (now() − SYNC_PULL_SETTLE_MS), así lo que confirma tarde no queda detrás del cursor.
 * Lo que cruza el enlace (escalamientos a Tierra y mensajes) solo sale con deliver_at
 * <= horizon: durante un corte deliver_at es NULL y no sale nada.
 */
const { pool } = require('../config/db');

// ---------------------------------------------------------------- push

/** ¿El dispositivo es del usuario? Su sesión, uno con el que inició sesión o una tableta de su misión. */
async function deviceOwned({ userId, deviceId, missionId }, db = pool) {
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM refresh_tokens WHERE user_id = $1 AND device_id = $2)
         OR EXISTS (SELECT 1 FROM offline_pins WHERE user_id = $1 AND device_id = $2)
         OR EXISTS (SELECT 1 FROM devices
                    WHERE mission_id = $3 AND lower(label) = lower($2) AND status = 'active')
       AS owned`,
    [userId, deviceId, missionId],
  );
  return rows[0].owned;
}

async function insertBatch({ userId, deviceId, sentAt, itemCount, clockOffsetMs }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO sync_batches (user_id, device_id, sent_at, item_count, clock_offset_ms)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, received_at`,
    [userId, deviceId, sentAt, itemCount, clockOffsetMs],
  );
  return rows[0];
}

async function finishBatch({ id, counts, durationMs }, db = pool) {
  await db.query(
    `UPDATE sync_batches
     SET accepted_count = $2, duplicate_count = $3, conflict_count = $4, rejected_count = $5,
         late_count = $6, duration_ms = $7
     WHERE id = $1`,
    [
      id,
      counts.accepted,
      counts.duplicate,
      counts.conflict,
      counts.rejected,
      counts.late,
      durationMs,
    ],
  );
}

async function insertItem(row, db = pool) {
  await db.query(
    `INSERT INTO sync_items (batch_id, client_uuid, entity, priority, created_at, status,
                             server_id, error_code, conflict_detail, payload_hash, late_sync, lag_s)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      row.batchId,
      row.clientUuid,
      row.entity,
      row.priority,
      row.createdAt,
      row.status,
      row.serverId || null,
      row.errorCode || null,
      row.conflictDetail || null,
      row.payloadHash,
      Boolean(row.lateSync),
      row.lagS ?? null,
    ],
  );
}

/** Hash del payload con que se aceptó este client_uuid por sync (null si nunca llegó por sync). */
async function acceptedHash({ userId, entity, clientUuid }, db = pool) {
  const { rows } = await db.query(
    `SELECT si.payload_hash, si.server_id
     FROM sync_items si JOIN sync_batches b ON b.id = si.batch_id
     WHERE b.user_id = $1 AND si.client_uuid = $2 AND si.entity = $3
       AND si.status = 'accepted' AND si.payload_hash IS NOT NULL
     ORDER BY si.id LIMIT 1`,
    [userId, clientUuid, entity],
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------- pull

/** Clave keyset: [marca como texto de PostgreSQL (µs), id]. */
const after = (key, n) => (key ? `AND (ts, id) > ($${n}::timestamptz, $${n + 1}::uuid)` : '');
const keyParams = (key) => (key ? [key[0], key[1]] : []);

/** Lecturas propias ESTÁNDAR con su evaluación (v_readings_standard; nunca bienestar). */
async function evaluationsPage({ astronautId, horizon, key, limit }, db = pool) {
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT e.evaluated_at AS ts, r.id, r.client_uuid, r.supersedes_uuid, r.indicator_code,
              r.measured_at, r.received_at, e.level, e.rule_index, e.rules_version,
              e.recommendation, e.escalation, e.basis, e.source_ids, e.escalation_id,
              to_char(e.evaluated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ts_text
       FROM v_readings_standard r JOIN reading_evaluations e ON e.reading_id = r.id
       WHERE r.astronaut_id = $1 AND e.evaluated_at <= $2) x
     WHERE true ${after(key, 4)}
     ORDER BY ts, id LIMIT $3`,
    [astronautId, horizon, limit + 1, ...keyParams(key)],
  );
  return rows;
}

/**
 * Escalamientos del astronauta que ya llegaron a destino (deliver_at <= horizon). Nunca los
 * confidenciales (bienestar): a la tripulación solo le llegan mensajes neutros.
 */
async function escalationsPage({ astronautId, horizon, key, limit }, db = pool) {
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT e.deliver_at AS ts, e.id, e.source_type, e.source_id, e.level::text AS level,
              e.priority::text AS priority, e.status::text AS status, e.reason, e.created_at,
              e.deliver_at, to_char(e.deliver_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ts_text
       FROM escalations e
       WHERE e.astronaut_id = $1 AND NOT e.is_confidential AND e.category <> 'behavioral'
         AND e.deliver_at IS NOT NULL AND e.deliver_at <= $2) x
     WHERE true ${after(key, 4)}
     ORDER BY ts, id LIMIT $3`,
    [astronautId, horizon, limit + 1, ...keyParams(key)],
  );
  return rows;
}

/** Mensajes de Tierra en sus escalamientos (no confidenciales), ya entregados. */
async function escalationMessagesPage({ astronautId, horizon, key, limit }, db = pool) {
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT m.deliver_at AS ts, m.id, m.escalation_id AS thread_id, m.direction::text AS direction,
              u.role::text AS author_role, m.body, m.created_at, m.deliver_at,
              to_char(m.deliver_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ts_text
       FROM escalation_messages m
       JOIN escalations e ON e.id = m.escalation_id
       LEFT JOIN users u ON u.id = m.author_id
       WHERE e.astronaut_id = $1 AND NOT e.is_confidential AND m.direction = 'to_crew'
         AND m.deliver_at IS NOT NULL AND m.deliver_at <= $2) x
     WHERE true ${after(key, 4)}
     ORDER BY ts, id LIMIT $3`,
    [astronautId, horizon, limit + 1, ...keyParams(key)],
  );
  return rows;
}

/**
 * Respuestas a sus propias solicitudes de apoyo ("Quiero hablar con alguien"). Son suyas:
 * el astronauta ve su conversación; nadie más de la tripulación.
 */
async function supportMessagesPage({ astronautId, horizon, key, limit }, db = pool) {
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT sm.deliver_at AS ts, sm.id, sm.request_id AS thread_id,
              sm.direction::text AS direction, sm.author_role::text AS author_role, sm.body,
              sm.created_at, sm.deliver_at,
              to_char(sm.deliver_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ts_text
       FROM support_messages sm
       JOIN support_requests s ON s.id = sm.request_id
       WHERE s.astronaut_id = $1 AND sm.direction = 'to_crew'
         AND sm.deliver_at IS NOT NULL AND sm.deliver_at <= $2) x
     WHERE true ${after(key, 4)}
     ORDER BY ts, id LIMIT $3`,
    [astronautId, horizon, limit + 1, ...keyParams(key)],
  );
  return rows;
}

async function horizon(settleMs, db = pool) {
  const { rows } = await db.query(
    `SELECT now() AS server_time,
            now() - make_interval(secs => $1::float8 / 1000) AS horizon`,
    [settleMs],
  );
  return rows[0];
}

/** Recordatorios pendientes (no hechos, de las últimas 24 h en adelante). */
async function pendingReminders(astronautId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, kind, title, due_at, indicator_code FROM reminders
     WHERE astronaut_id = $1 AND done_at IS NULL AND due_at >= now() - interval '24 hours'
     ORDER BY due_at, id LIMIT 100`,
    [astronautId],
  );
  return rows;
}

async function activeRoutines(astronautId, db = pool) {
  const { rows } = await db.query(
    `SELECT code, title, indicator_codes, schedule FROM routines
     WHERE astronaut_id = $1 AND is_active ORDER BY code`,
    [astronautId],
  );
  return rows;
}

async function activeProtocol(db = pool) {
  const { rows } = await db.query(
    'SELECT code, version FROM triage_protocols WHERE is_active ORDER BY code, version DESC LIMIT 1',
  );
  return rows[0] || null;
}

/** Misión y enlace: versión = updated_at de la misión y del entorno (cambia si cambia la config). */
async function missionState(missionId, db = pool) {
  const { rows } = await db.query(
    `SELECT m.id, m.code, m.status, m.ends_at, e.comm_delay_seconds,
            to_char(greatest(m.updated_at, e.updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version,
            (SELECT o.ends_at FROM mission_comm_outages o
             WHERE o.mission_id = m.id AND o.starts_at <= now()
               AND (o.ends_at IS NULL OR o.ends_at > now())
             ORDER BY o.starts_at DESC LIMIT 1) AS outage_ends_at,
            EXISTS (SELECT 1 FROM mission_comm_outages o
                    WHERE o.mission_id = m.id AND o.starts_at <= now()
                      AND (o.ends_at IS NULL OR o.ends_at > now())) AS outage_active
     FROM missions m JOIN environments e ON e.code = m.environment_code
     WHERE m.id = $1`,
    [missionId],
  );
  return rows[0] || null;
}

module.exports = {
  deviceOwned,
  insertBatch,
  finishBatch,
  insertItem,
  acceptedHash,
  evaluationsPage,
  escalationsPage,
  escalationMessagesPage,
  supportMessagesPage,
  horizon,
  pendingReminders,
  activeRoutines,
  activeProtocol,
  missionState,
};
