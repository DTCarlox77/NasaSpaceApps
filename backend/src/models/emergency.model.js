'use strict';

/**
 * Modo emergencia (tarea 9): protocolo, sesiones, hombre muerto, evaluaciones, respuestas,
 * línea de tiempo, reporte y consultas del panel. La lógica (permisos, evaluación con
 * evaluateAssessment, escalamientos) vive en los servicios; aquí solo SQL.
 *
 * Lo que cruza el enlace hacia Tierra (emergency_events) lleva deliver_at =
 * compute_deliver_at(misión, now()); los cortes lo recalculan (escalations.recomputePending).
 * Las lecturas que se usan (prellenado, contexto) salen de v_readings_standard: el triaje no
 * incluye datos de bienestar.
 */
const { pool } = require('../config/db');

const PROTOCOL_CODE = 'crew_emergency';

// ---------------------------------------------------------------- protocolo

const PROTOCOL_COLUMNS = 'id, code, version, name, is_active, sources, definition, created_at';

async function activeProtocol(db = pool) {
  const { rows } = await db.query(
    `SELECT ${PROTOCOL_COLUMNS} FROM triage_protocols WHERE code = $1 AND is_active`,
    [PROTOCOL_CODE],
  );
  return rows[0] || null;
}

async function protocolById(id, db = pool) {
  const { rows } = await db.query(
    `SELECT ${PROTOCOL_COLUMNS} FROM triage_protocols WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function protocolByVersion(version, db = pool) {
  const { rows } = await db.query(
    `SELECT ${PROTOCOL_COLUMNS} FROM triage_protocols WHERE code = $1 AND version = $2`,
    [PROTOCOL_CODE, version],
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------- sesiones

const SESSION_COLUMNS = `s.id, s.client_uuid, s.mission_id, s.protocol_id, s.trigger_type::text AS trigger_type,
  s.started_by, s.status::text AS status, s.context, s.started_at, s.closed_at, s.received_at,
  s.synthetic, s.device_id, s.merged_into, s.responder_safe, s.activated_at, s.last_heartbeat_at,
  s.heartbeat_lapsed_at, s.closed_by, s.close_notes, p.code AS protocol_code,
  p.version AS protocol_version, m.code AS mission_code`;
const SESSION_FROM = `emergency_sessions s
  JOIN triage_protocols p ON p.id = s.protocol_id
  JOIN missions m ON m.id = s.mission_id`;

async function findSession(id, db = pool) {
  const { rows } = await db.query(
    `SELECT ${SESSION_COLUMNS} FROM ${SESSION_FROM} WHERE s.id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** Por id del servidor o por client_uuid (la app sin conexión solo conoce el suyo). */
async function findSessionByRef(ref, db = pool) {
  const { rows } = await db.query(
    `SELECT ${SESSION_COLUMNS} FROM ${SESSION_FROM} WHERE s.id = $1 OR s.client_uuid = $1
     ORDER BY (s.id = $1) DESC LIMIT 1`,
    [ref],
  );
  return rows[0] || null;
}

async function findSessionByClientUuid(clientUuid, db = pool) {
  const { rows } = await db.query(
    `SELECT ${SESSION_COLUMNS} FROM ${SESSION_FROM} WHERE s.client_uuid = $1`,
    [clientUuid],
  );
  return rows[0] || null;
}

/** La sesión abierta (pending o active) de la misión, bloqueada si se pide. */
async function openSession(missionId, db = pool, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT s.id FROM emergency_sessions s
     WHERE s.mission_id = $1 AND s.status IN ('pending', 'active')
     ${lock ? 'FOR UPDATE' : ''}`,
    [missionId],
  );
  return rows[0] ? findSession(rows[0].id, db) : null;
}

/** Inserta la sesión. Devuelve { id, created } (created = false si el client_uuid ya existía). */
async function insertSession(row, db) {
  const { rows } = await db.query(
    `INSERT INTO emergency_sessions (client_uuid, mission_id, protocol_id, trigger_type, started_by,
                                     status, context, started_at, closed_at, responder_safe,
                                     activated_at, merged_into, device_id)
     VALUES ($1, $2, $3, $4::emergency_trigger, $5, $6::emergency_status, $7, $8, $9, $10, $11, $12,
             $13)
     ON CONFLICT (client_uuid) DO NOTHING
     RETURNING id`,
    [
      row.clientUuid,
      row.missionId,
      row.protocolId,
      row.triggerType,
      row.startedBy || null,
      row.status,
      row.context || {},
      row.startedAt,
      row.closedAt || null,
      row.responderSafe ?? null,
      row.activatedAt || null,
      row.mergedInto || null,
      row.deviceId || null,
    ],
  );
  if (rows[0]) return { id: rows[0].id, created: true };
  const existing = await findSessionByClientUuid(row.clientUuid, db);
  return { id: existing.id, created: false };
}

/** pending → active, una sola vez. Devuelve true si la activó esta llamada. */
async function activateSession(id, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE emergency_sessions SET status = 'active', activated_at = now()
     WHERE id = $1 AND status = 'pending'`,
    [id],
  );
  return rowCount > 0;
}

/** Cierra o cancela una sesión abierta. Devuelve true si la cerró esta llamada. */
async function closeSession({ id, status, closedAt, closedBy, notes }, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE emergency_sessions
     SET status = $2::emergency_status, closed_at = greatest($3::timestamptz, started_at),
         closed_by = $4, close_notes = $5
     WHERE id = $1 AND status IN ('pending', 'active')`,
    [id, status, closedAt, closedBy || null, notes ?? null],
  );
  return rowCount > 0;
}

async function setResponderSafe(id, value, db = pool) {
  await db.query(
    'UPDATE emergency_sessions SET responder_safe = $2 WHERE id = $1 AND responder_safe IS NULL',
    [id, value],
  );
}

async function heartbeat(id, at, db = pool) {
  const { rows } = await db.query(
    `UPDATE emergency_sessions SET last_heartbeat_at = $2, heartbeat_lapsed_at = NULL
     WHERE id = $1 AND status = 'active'
     RETURNING last_heartbeat_at`,
    [id, at],
  );
  return rows[0] || null;
}

/** Sesiones activas cuyo latido venció (dead_man_switch_seconds del protocolo); una sola vez. */
async function lapseHeartbeats(now, db = pool) {
  const { rows } = await db.query(
    `UPDATE emergency_sessions s SET heartbeat_lapsed_at = $1
     FROM triage_protocols p
     WHERE p.id = s.protocol_id AND s.status = 'active' AND s.last_heartbeat_at IS NOT NULL
       AND s.heartbeat_lapsed_at IS NULL
       AND s.last_heartbeat_at
           + make_interval(secs => coalesce((p.definition->>'dead_man_switch_seconds')::int, 120))
           <= $1::timestamptz
     RETURNING s.id, s.last_heartbeat_at`,
    [now],
  );
  return rows;
}

/** Filas fusionadas en esta sesión (activaciones que se unieron). */
async function mergedInto(id, db = pool) {
  const { rows } = await db.query(
    `SELECT id, client_uuid, trigger_type::text AS trigger_type, started_by, started_at,
            received_at, device_id
     FROM emergency_sessions WHERE merged_into = $1 ORDER BY received_at, id`,
    [id],
  );
  return rows;
}

// ---------------------------------------------------------------- hombre muerto

async function insertDeadman(
  { sessionId, astronautId, triggerType, sourceReadingId, deadlineAt },
  db = pool,
) {
  const { rows } = await db.query(
    `INSERT INTO emergency_deadman (session_id, astronaut_id, trigger_type, source_reading_id,
                                    deadline_at)
     VALUES ($1, $2, $3::emergency_trigger, $4, $5)
     ON CONFLICT (session_id, astronaut_id) DO NOTHING
     RETURNING id`,
    [sessionId, astronautId, triggerType, sourceReadingId || null, deadlineAt],
  );
  return rows.length > 0;
}

async function deadmanFor(sessionId, db = pool) {
  const { rows } = await db.query(
    `SELECT d.astronaut_id, a.call_sign, d.trigger_type::text AS trigger_type,
            d.source_reading_id, d.deadline_at, d.confirmed_at, d.expired_at, d.created_at
     FROM emergency_deadman d JOIN astronauts a ON a.id = d.astronaut_id
     WHERE d.session_id = $1 ORDER BY d.created_at, a.call_sign`,
    [sessionId],
  );
  return rows;
}

/** "Estoy bien": solo si no venció. Devuelve 'confirmed' | 'already' | 'expired' | 'none'. */
async function confirmDeadman({ sessionId, astronautId, userId, at }, db = pool) {
  const { rows } = await db.query(
    `UPDATE emergency_deadman SET confirmed_at = $4, confirmed_by = $3
     WHERE session_id = $1 AND astronaut_id = $2 AND confirmed_at IS NULL AND expired_at IS NULL
     RETURNING id`,
    [sessionId, astronautId, userId, at],
  );
  if (rows[0]) return 'confirmed';
  const { rows: current } = await db.query(
    'SELECT confirmed_at, expired_at FROM emergency_deadman WHERE session_id = $1 AND astronaut_id = $2',
    [sessionId, astronautId],
  );
  if (!current[0]) return 'none';
  return current[0].confirmed_at ? 'already' : 'expired';
}

async function unresolvedDeadman(sessionId, db = pool) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM emergency_deadman
     WHERE session_id = $1 AND confirmed_at IS NULL`,
    [sessionId],
  );
  return rows[0].n;
}

/** Vence (una sola vez) los plazos cumplidos a `now`. expired_at = el plazo, no el barrido. */
async function expireDeadman(now, db = pool) {
  const { rows } = await db.query(
    `UPDATE emergency_deadman SET expired_at = deadline_at
     WHERE deadline_at <= $1::timestamptz AND confirmed_at IS NULL AND expired_at IS NULL
     RETURNING session_id, astronaut_id, trigger_type::text AS trigger_type, deadline_at`,
    [now],
  );
  return rows;
}

// ---------------------------------------------------------------- línea de tiempo

async function insertEvent(e, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO emergency_events (session_id, event_type, clinical, actor_user_id, actor_device,
                                   astronaut_id, assessment_id, client_uuid, details, device_at,
                                   deliver_at)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, compute_deliver_at(s.mission_id, now())
     FROM emergency_sessions s WHERE s.id = $1
     ON CONFLICT (client_uuid) DO NOTHING
     RETURNING id`,
    [
      e.sessionId,
      e.type,
      Boolean(e.clinical),
      e.actorUserId || null,
      e.actorDevice || null,
      e.astronautId || null,
      e.assessmentId || null,
      e.clientUuid || null,
      e.details || {},
      e.deviceAt || null,
    ],
  );
  return rows[0] ? rows[0].id : null;
}

/** Línea de tiempo; `delivered` = solo lo que ya llegó a Tierra. */
async function eventsFor(sessionId, { delivered = false } = {}, db = pool) {
  const { rows } = await db.query(
    `SELECT e.id, e.event_type, e.clinical, e.actor_user_id, u.role::text AS actor_role,
            e.actor_device, e.astronaut_id, a.call_sign, e.assessment_id, e.details, e.device_at,
            e.created_at, e.deliver_at
     FROM emergency_events e
     LEFT JOIN users u ON u.id = e.actor_user_id
     LEFT JOIN astronauts a ON a.id = e.astronaut_id
     WHERE e.session_id = $1
       ${delivered ? 'AND e.deliver_at IS NOT NULL AND e.deliver_at <= now()' : ''}
     ORDER BY e.id`,
    [sessionId],
  );
  return rows;
}

// ---------------------------------------------------------------- evaluaciones

const ASSESSMENT_COLUMNS = `ea.id, ea.client_uuid, ea.session_id, ea.astronaut_id, a.call_sign,
  ea.assessed_by, ea.is_self_assessment, ea.sequence_no, ea.status::text AS status,
  ea.triage_category::text AS triage_category, ea.radiation_flag, ea.computed_by,
  ea.rules_version, ea.started_at, ea.completed_at, ea.protocol_id, ea.reassessment_of,
  ea.result, ea.device_result, ea.matches_device, ea.received_at, ea.notes`;
const ASSESSMENT_FROM = 'emergency_assessments ea JOIN astronauts a ON a.id = ea.astronaut_id';

async function insertAssessment(row, db) {
  const { rows } = await db.query(
    `INSERT INTO emergency_assessments (client_uuid, session_id, astronaut_id, assessed_by,
                                        is_self_assessment, sequence_no, started_at, protocol_id,
                                        reassessment_of, rules_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (client_uuid) DO NOTHING
     RETURNING id`,
    [
      row.clientUuid,
      row.sessionId,
      row.astronautId,
      row.assessedBy || null,
      Boolean(row.isSelfAssessment),
      row.sequenceNo,
      row.startedAt,
      row.protocolId,
      row.reassessmentOf || null,
      row.rulesVersion,
    ],
  );
  return rows[0] ? { id: rows[0].id, created: true } : { id: null, created: false };
}

async function findAssessment(id, db = pool) {
  const { rows } = await db.query(
    `SELECT ${ASSESSMENT_COLUMNS} FROM ${ASSESSMENT_FROM} WHERE ea.id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** Por id del servidor o por client_uuid. */
async function findAssessmentByRef(ref, db = pool) {
  const { rows } = await db.query(
    `SELECT ${ASSESSMENT_COLUMNS} FROM ${ASSESSMENT_FROM}
     WHERE ea.id = $1 OR ea.client_uuid = $1 ORDER BY (ea.id = $1) DESC LIMIT 1`,
    [ref],
  );
  return rows[0] || null;
}

async function lockAssessment(id, db) {
  await db.query('SELECT 1 FROM emergency_assessments WHERE id = $1 FOR UPDATE', [id]);
  return findAssessment(id, db);
}

async function latestAssessmentOf(sessionId, astronautId, db = pool) {
  const { rows } = await db.query(
    `SELECT id FROM emergency_assessments WHERE session_id = $1 AND astronaut_id = $2
     ORDER BY started_at DESC, received_at DESC LIMIT 1`,
    [sessionId, astronautId],
  );
  return rows[0] ? rows[0].id : null;
}

async function assessmentsFor(sessionId, db = pool) {
  const { rows } = await db.query(
    `SELECT ${ASSESSMENT_COLUMNS} FROM ${ASSESSMENT_FROM} WHERE ea.session_id = $1
     ORDER BY ea.started_at, ea.received_at, ea.id`,
    [sessionId],
  );
  return rows;
}

async function completeAssessment(
  { id, triageCategory, radiationFlag, completedAt, rulesVersion, result, deviceResult, matches },
  db,
) {
  const { rowCount } = await db.query(
    `UPDATE emergency_assessments
     SET status = 'completed', triage_category = $2::triage_category, radiation_flag = $3,
         completed_at = greatest($4::timestamptz, started_at), computed_by = 'server',
         rules_version = $5, result = $6, device_result = $7, matches_device = $8
     WHERE id = $1 AND status = 'in_progress'`,
    [id, triageCategory, radiationFlag, completedAt, rulesVersion, result, deviceResult, matches],
  );
  return rowCount > 0;
}

/** Sin completar (incomplete/stopped): guarda el último cálculo y lo que mandó la tableta. */
async function saveProvisional({ id, result, deviceResult, matches }, db = pool) {
  await db.query(
    `UPDATE emergency_assessments SET result = $2, device_result = coalesce($3, device_result),
            matches_device = coalesce($4, matches_device)
     WHERE id = $1 AND status = 'in_progress'`,
    [id, result, deviceResult, matches],
  );
}

// ---------------------------------------------------------------- respuestas

async function insertAnswer(row, db) {
  const { rows } = await db.query(
    `INSERT INTO emergency_answers (client_uuid, assessment_id, question_code, answer, source,
                                    source_reading_id, answered_at)
     VALUES ($1, $2, $3, $4, $5::answer_source, $6, $7)
     ON CONFLICT (client_uuid) DO NOTHING
     RETURNING id`,
    [
      row.clientUuid,
      row.assessmentId,
      row.questionCode,
      row.answer,
      row.source,
      row.sourceReadingId || null,
      row.answeredAt,
    ],
  );
  return rows.length > 0;
}

/** client_uuid de respuestas que ya existen (para responder duplicate sin error). */
async function existingAnswers(clientUuids, db = pool) {
  const { rows } = await db.query(
    'SELECT client_uuid FROM emergency_answers WHERE client_uuid = ANY($1::uuid[])',
    [clientUuids],
  );
  return new Set(rows.map((r) => r.client_uuid));
}

async function answersFor(assessmentId, db = pool) {
  const { rows } = await db.query(
    `SELECT client_uuid, question_code, answer, source::text AS source, source_reading_id,
            answered_at, received_at
     FROM emergency_answers WHERE assessment_id = $1
     ORDER BY answered_at, id`,
    [assessmentId],
  );
  return rows;
}

// ---------------------------------------------------------------- tripulación y contexto

async function crewOfMission(missionId, db = pool) {
  const { rows } = await db.query(
    `SELECT c.astronaut_id, c.user_id, c.call_sign, c.crew_role
     FROM v_current_crew c JOIN users u ON u.id = c.user_id
     WHERE c.mission_id = $1 AND u.is_active
     ORDER BY lower(c.call_sign)`,
    [missionId],
  );
  return rows;
}

/** Última lectura CRÍTICA estándar de cada tripulante en los últimos `minutes`. */
async function recentCritical(missionId, minutes, db = pool) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (r.astronaut_id) r.astronaut_id, r.id AS reading_id, r.indicator_code,
            r.measured_at
     FROM v_readings_standard r JOIN reading_evaluations e ON e.reading_id = r.id
     WHERE r.mission_id = $1 AND r.astronaut_id IS NOT NULL AND e.level = 'critical'
       AND r.measured_at >= now() - make_interval(mins => $2::int)
     ORDER BY r.astronaut_id, r.measured_at DESC`,
    [missionId, minutes],
  );
  return rows;
}

/** Última lectura estándar de un indicador para el prellenado (v_readings_standard). */
async function latestReading({ astronautId, indicatorCode, maxAgeMinutes }, db = pool) {
  const { rows } = await db.query(
    `SELECT r.id, r.components, r.measured_at FROM v_readings_standard r
     WHERE r.astronaut_id = $1 AND r.indicator_code = $2
       AND r.measured_at >= now() - make_interval(mins => $3::int)
       AND NOT EXISTS (SELECT 1 FROM readings s
                       WHERE s.recorded_by = r.recorded_by AND s.supersedes_uuid = r.client_uuid)
     ORDER BY r.measured_at DESC LIMIT 1`,
    [astronautId, indicatorCode, maxAgeMinutes],
  );
  return rows[0] || null;
}

/** Contexto para una activación automática (lo que la app pondría a mano). */
async function autoContext(missionId, db = pool) {
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM v_readings_standard r
                    WHERE r.mission_id = $1 AND r.indicator_code = 'RAD_DOSE_DAILY'
                      AND (r.components->>'event_active')::boolean IS TRUE
                      AND r.measured_at >= now() - interval '24 hours') AS solar_event_active,
            EXISTS (SELECT 1 FROM v_readings_standard r JOIN reading_evaluations e ON e.reading_id = r.id
                    WHERE r.mission_id = $1 AND r.indicator_code = 'HAB_CO2' AND e.level = 'critical'
                      AND r.measured_at >= now() - interval '1 hour') AS co2_alarm`,
    [missionId],
  );
  return {
    solar_event_active: rows[0].solar_event_active,
    environment_alarm: rows[0].co2_alarm ? 'co2' : null,
  };
}

async function activeMissions(db = pool) {
  const { rows } = await db.query(`SELECT id, code FROM missions WHERE status = 'active'`);
  return rows;
}

/**
 * Último check-in de cada tripulante vigente y si ya hubo una activación por check-in
 * perdido después de `since` (para no repetirla). Solo la hora: nunca los valores.
 */
async function checkinState(missionId, db = pool) {
  const { rows } = await db.query(
    `SELECT c.astronaut_id, c.call_sign,
            (SELECT max(w.measured_at) FROM wellbeing_checkins w
             WHERE w.astronaut_id = c.astronaut_id) AS last_checkin_at,
            (SELECT max(d.created_at) FROM emergency_deadman d
             WHERE d.astronaut_id = c.astronaut_id AND d.trigger_type = 'missed_checkin')
              AS last_missed_trigger_at
     FROM v_current_crew c JOIN users u ON u.id = c.user_id
     WHERE c.mission_id = $1 AND u.is_active`,
    [missionId],
  );
  return rows;
}

// ---------------------------------------------------------------- marcas y reporte

async function setMarker(key, at, db = pool) {
  await db.query(
    `INSERT INTO system_markers (key, at) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET at = EXCLUDED.at, updated_at = now()`,
    [key, at],
  );
}

async function getMarker(key, db = pool) {
  const { rows } = await db.query('SELECT at FROM system_markers WHERE key = $1', [key]);
  return rows[0] ? rows[0].at : null;
}

async function insertReport(sessionId, report, db = pool) {
  await db.query(
    `INSERT INTO emergency_reports (session_id, report) VALUES ($1, $2)
     ON CONFLICT (session_id) DO NOTHING`,
    [sessionId, report],
  );
}

async function reportFor(sessionId, db = pool) {
  const { rows } = await db.query(
    'SELECT report, generated_at FROM emergency_reports WHERE session_id = $1',
    [sessionId],
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------- escalamientos de la sesión

/** Escalamientos de la sesión y de sus evaluaciones (para el resumen y el panel). */
async function sessionEscalations(sessionId, { groundDelivered = false } = {}, db = pool) {
  const { rows } = await db.query(
    `SELECT e.id, e.level::text AS level, e.priority::text AS priority,
            CASE WHEN e.status = 'queued' AND e.deliver_at <= now() THEN 'delivered'
                 ELSE e.status::text END AS status,
            e.deliver_at, e.created_at, e.source_type, e.source_id, e.astronaut_id
     FROM escalations e
     WHERE ((e.source_type = 'emergency_session' AND e.source_id = $1)
        OR (e.source_type = 'emergency_assessment'
            AND e.source_id IN (SELECT id FROM emergency_assessments WHERE session_id = $1)))
       ${groundDelivered ? `AND e.level = 'flight_surgeon' AND e.deliver_at <= now()` : ''}
     ORDER BY e.created_at, e.id`,
    [sessionId],
  );
  return rows;
}

/** El escalamiento a Tierra de la sesión que recibe las preguntas fuera del protocolo. */
async function sessionThread(sessionId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, deliver_at FROM escalations
     WHERE source_type = 'emergency_session' AND source_id = $1 AND level = 'flight_surgeon'
     ORDER BY created_at, id LIMIT 1`,
    [sessionId],
  );
  return rows[0] || null;
}

async function insertQuestion({ clientUuid, escalationId, missionId, authorId, body }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO escalation_messages (client_uuid, escalation_id, direction, author_id, body,
                                      deliver_at)
     VALUES ($1, $2, 'to_earth', $3, $4, compute_deliver_at($5::uuid, now()))
     ON CONFLICT (client_uuid) DO NOTHING
     RETURNING id`,
    [clientUuid, escalationId, authorId, body, missionId],
  );
  const created = rows.length > 0;
  const { rows: found } = await db.query(
    `SELECT id, escalation_id, direction::text AS direction, body, created_at, deliver_at
     FROM escalation_messages WHERE client_uuid = $1`,
    [clientUuid],
  );
  return { row: found[0], created };
}

/** Mensajes del hilo de la sesión (preguntas a Tierra y respuestas). */
async function sessionMessages(sessionId, { delivered = false } = {}, db = pool) {
  const { rows } = await db.query(
    `SELECT m.id, m.escalation_id, m.direction::text AS direction, u.role::text AS author_role,
            m.body, m.created_at, m.deliver_at
     FROM escalation_messages m
     JOIN escalations e ON e.id = m.escalation_id
     LEFT JOIN users u ON u.id = m.author_id
     WHERE e.source_type = 'emergency_session' AND e.source_id = $1
       ${delivered ? 'AND m.deliver_at IS NOT NULL AND m.deliver_at <= now()' : ''}
     ORDER BY m.created_at, m.id`,
    [sessionId],
  );
  return rows;
}

// ---------------------------------------------------------------- panel

/**
 * Sesiones que ya llegaron a Tierra: alguno de sus escalamientos a flight_surgeon tiene
 * deliver_at <= now(). Las fusionadas no se listan (se ven dentro de la principal).
 */
async function groundPage({ missionId, status, after, limit }, db = pool) {
  const params = [missionId, status || null, limit + 1];
  let cursorSql = '';
  if (after) {
    params.push(after.s, after.id);
    cursorSql = 'AND (x.started_at, x.id) < ($4::timestamptz, $5::uuid)';
  }
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT s.id, s.mission_id, m.code AS mission_code, s.trigger_type::text AS trigger_type,
              s.status::text AS status, s.started_at, s.closed_at, s.received_at,
              s.started_at::text AS started_at_cursor,
              (SELECT min(e.deliver_at) FROM escalations e
               WHERE e.level = 'flight_surgeon' AND e.deliver_at <= now()
                 AND ((e.source_type = 'emergency_session' AND e.source_id = s.id)
                   OR (e.source_type = 'emergency_assessment' AND e.source_id IN
                        (SELECT ea.id FROM emergency_assessments ea WHERE ea.session_id = s.id))))
                AS first_delivered_at
       FROM emergency_sessions s JOIN missions m ON m.id = s.mission_id
       WHERE s.mission_id = $1 AND s.status <> 'merged'
         AND ($2::text IS NULL OR s.status::text = $2)) x
     WHERE x.first_delivered_at IS NOT NULL ${cursorSql}
     ORDER BY x.started_at DESC, x.id DESC
     LIMIT $3`,
    params,
  );
  return rows;
}

module.exports = {
  PROTOCOL_CODE,
  activeProtocol,
  protocolById,
  protocolByVersion,
  findSession,
  findSessionByRef,
  findSessionByClientUuid,
  openSession,
  insertSession,
  activateSession,
  closeSession,
  setResponderSafe,
  heartbeat,
  lapseHeartbeats,
  mergedInto,
  insertDeadman,
  deadmanFor,
  confirmDeadman,
  unresolvedDeadman,
  expireDeadman,
  insertEvent,
  eventsFor,
  insertAssessment,
  findAssessment,
  findAssessmentByRef,
  lockAssessment,
  latestAssessmentOf,
  assessmentsFor,
  completeAssessment,
  saveProvisional,
  insertAnswer,
  existingAnswers,
  answersFor,
  crewOfMission,
  recentCritical,
  latestReading,
  autoContext,
  activeMissions,
  checkinState,
  setMarker,
  getMarker,
  insertReport,
  reportFor,
  sessionEscalations,
  sessionThread,
  insertQuestion,
  sessionMessages,
  groundPage,
};
