'use strict';

/**
 * Consultas de salud conductual (CONFIDENCIAL, solo behavioral_health): bandeja de
 * escalamientos conductuales y solicitudes de apoyo, y el detalle por astronauta.
 * Lo que cruza el enlace (escalamientos y solicitudes) solo aparece con deliver_at <= now().
 * La nota privada del check-in NUNCA se selecciona aquí: solo la ve el astronauta.
 */
const { pool } = require('../config/db');

const TS_TEXT = (expr) => `to_char(${expr} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const CURRENT_READING = `NOT EXISTS (SELECT 1 FROM readings s
  WHERE s.recorded_by = r.recorded_by AND s.supersedes_uuid = r.client_uuid)`;

// Orden de la bandeja (regla de diseño): apoyo "ahora", alertas urgentes, apoyo "hoy",
// alertas de rutina, apoyo "más tarde"; dentro, lo que llegó antes primero.
const ESCALATION_RANK = `CASE WHEN e.priority IN ('emergency', 'urgent') THEN 1 ELSE 3 END`;
const SUPPORT_RANK = `CASE s.urgency WHEN 'now' THEN 0 WHEN 'today' THEN 2 ELSE 4 END`;

/**
 * Página de la bandeja de behavioral_health de la misión: escalamientos behavioral_health y
 * solicitudes de apoyo ya entregados en Tierra. includeClosed = false: solo lo abierto.
 */
async function inboxPage({ missionId, includeClosed, after, limit }, db = pool) {
  const params = [missionId, includeClosed, limit + 1];
  let cursorSql = '';
  if (after) {
    params.push(after.r, after.d, after.id);
    cursorSql = 'AND (x.rank, x.deliver_at, x.id) > ($4::int, $5::timestamptz, $6::uuid)';
  }
  const { rows } = await db.query(
    `SELECT x.*, ${TS_TEXT('x.deliver_at')} AS deliver_at_text FROM (
       SELECT e.id, 'escalation'::text AS source, e.astronaut_id, a.call_sign,
              r.indicator_code, NULL::text AS urgency, NULL::text AS channel,
              CASE WHEN e.status = 'queued' THEN 'delivered' ELSE e.status::text END AS status,
              e.priority::text AS priority, ev.level AS ev_level, ev.derived AS ev_derived,
              e.created_at, e.deliver_at, r.measured_at, ${ESCALATION_RANK} AS rank
       FROM escalations e
       JOIN astronauts a ON a.id = e.astronaut_id
       LEFT JOIN readings r ON r.id = e.source_id
       LEFT JOIN reading_evaluations ev ON ev.reading_id = r.id
       WHERE e.mission_id = $1 AND e.level = 'behavioral_health'
         AND e.deliver_at IS NOT NULL AND e.deliver_at <= now()
         AND ($2::boolean OR e.status <> 'closed')
       UNION ALL
       SELECT s.id, 'support', s.astronaut_id, a.call_sign, NULL, s.urgency, s.channel,
              s.status, NULL, NULL, NULL, s.created_at, s.deliver_at, s.created_at,
              ${SUPPORT_RANK}
       FROM support_requests s
       JOIN astronauts a ON a.id = s.astronaut_id
       WHERE s.mission_id = $1 AND s.deliver_at IS NOT NULL AND s.deliver_at <= now()
         AND ($2::boolean OR s.status <> 'closed')
     ) x
     WHERE true ${cursorSql}
     ORDER BY x.rank, x.deliver_at, x.id
     LIMIT $3`,
    params,
  );
  return rows;
}

/** Astronauta y las misiones de sus asignaciones (vigente primero). */
async function astronautWithMissions(astronautId, db = pool) {
  const { rows } = await db.query(
    `SELECT a.id, a.call_sign,
            coalesce(array_agg(c.mission_id ORDER BY
              (c.assigned_from <= now() AND (c.assigned_to IS NULL OR c.assigned_to > now())) DESC,
              c.assigned_from DESC) FILTER (WHERE c.mission_id IS NOT NULL), '{}') AS mission_ids
     FROM astronauts a LEFT JOIN crew_assignments c ON c.astronaut_id = a.id
     WHERE a.id = $1
     GROUP BY a.id, a.call_sign`,
    [astronautId],
  );
  return rows[0] || null;
}

/** Lecturas vigentes de los indicadores pedidos desde `since`, con su evaluación (asc). */
async function indicatorReadings({ astronautId, codes, since }, db = pool) {
  const { rows } = await db.query(
    `SELECT r.indicator_code, r.components, r.measured_at, e.level,
            e.escalation::text AS escalation, e.derived
     FROM readings r LEFT JOIN reading_evaluations e ON e.reading_id = r.id
     WHERE r.astronaut_id = $1 AND r.indicator_code = ANY($2::text[]) AND r.measured_at >= $3
       AND ${CURRENT_READING}
     ORDER BY r.indicator_code, r.measured_at, r.received_at`,
    [astronautId, codes, since],
  );
  return rows;
}

/** Check-ins vigentes (los que nadie corrige) con sus valores vigentes. SIN la nota privada. */
async function checkins({ astronautId, since, limit }, db = pool) {
  const { rows } = await db.query(
    `SELECT c.id, c.measured_at, c.received_at, c.sleep_hours, c.supersedes_id,
            (SELECT jsonb_object_agg(r.indicator_code, r.components->'value')
             FROM readings r WHERE r.wellbeing_checkin_id = c.id AND ${CURRENT_READING}) AS vals
     FROM wellbeing_checkins c
     WHERE c.astronaut_id = $1 AND c.measured_at >= $2
       AND NOT EXISTS (SELECT 1 FROM wellbeing_checkins n WHERE n.supersedes_id = c.id)
     ORDER BY c.measured_at DESC, c.id DESC
     LIMIT $3`,
    [astronautId, since, limit],
  );
  return rows;
}

/** Cuestionarios con puntaje, ítems y nivel de la regla. */
async function screenings({ astronautId, limit }, db = pool) {
  const { rows } = await db.query(
    `SELECT a.id, i.code AS instrument, a.score, a.answers, a.measured_at, e.level
     FROM instrument_administrations a
     JOIN instruments i ON i.id = a.instrument_id
     LEFT JOIN readings r ON r.instrument_administration_id = a.id
     LEFT JOIN reading_evaluations e ON e.reading_id = r.id
     WHERE a.astronaut_id = $1
     ORDER BY a.measured_at DESC, a.id DESC
     LIMIT $2`,
    [astronautId, limit],
  );
  return rows;
}

/** Corridas PVT con sus métricas (lecturas del grupo) y aptitud. */
async function pvtRuns({ astronautId, limit }, db = pool) {
  const { rows } = await db.query(
    `SELECT p.id, p.device_id, p.measured_at, p.before_critical_task, p.fitness,
            (SELECT jsonb_object_agg(r.indicator_code, r.components->'value')
             FROM readings r WHERE r.pvt_run_id = p.id) AS vals
     FROM pvt_runs p WHERE p.astronaut_id = $1
     ORDER BY p.measured_at DESC, p.id DESC
     LIMIT $2`,
    [astronautId, limit],
  );
  return rows;
}

/** Solicitudes de apoyo del astronauta que ya llegaron a Tierra. */
async function deliveredSupportRequests({ astronautId, limit }, db = pool) {
  const { rows } = await db.query(
    `SELECT s.id, s.client_uuid, s.astronaut_id, s.status, s.urgency, s.channel, s.content,
            s.created_at, s.received_at, s.deliver_at
     FROM support_requests s
     WHERE s.astronaut_id = $1 AND s.deliver_at IS NOT NULL AND s.deliver_at <= now()
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT $2`,
    [astronautId, limit],
  );
  return rows;
}

/** Escalamientos conductuales del astronauta ya entregados y no cerrados. */
async function openEscalations(astronautId, db = pool) {
  const { rows } = await db.query(
    `SELECT e.id, r.indicator_code,
            CASE WHEN e.status = 'queued' THEN 'delivered' ELSE e.status::text END AS status,
            e.priority::text AS priority, e.created_at, e.deliver_at, r.measured_at
     FROM escalations e LEFT JOIN readings r ON r.id = e.source_id
     WHERE e.astronaut_id = $1 AND e.level = 'behavioral_health' AND e.status <> 'closed'
       AND e.deliver_at IS NOT NULL AND e.deliver_at <= now()
     ORDER BY e.deliver_at, e.id`,
    [astronautId],
  );
  return rows;
}

/** Días UTC distintos con check-in en [from, to), por astronauta (solo el conteo). */
async function checkinDaysBetween(astronautIds, from, to, db = pool) {
  const { rows } = await db.query(
    `SELECT astronaut_id, count(DISTINCT (measured_at AT TIME ZONE 'UTC')::date)::int AS days
     FROM wellbeing_checkins
     WHERE astronaut_id = ANY($1::uuid[]) AND measured_at >= $2 AND measured_at < $3
     GROUP BY astronaut_id`,
    [astronautIds, from, to],
  );
  return new Map(rows.map((r) => [r.astronaut_id, r.days]));
}

module.exports = {
  inboxPage,
  astronautWithMissions,
  indicatorReadings,
  checkins,
  screenings,
  pvtRuns,
  deliveredSupportRequests,
  openEscalations,
  checkinDaysBetween,
};
