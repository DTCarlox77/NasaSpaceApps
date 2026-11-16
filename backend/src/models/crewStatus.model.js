'use strict';

/**
 * Consultas de la pantalla "Tripulación" (GET /crew/status).
 * REGLA: solo datos físicos estándar y el estado de la emergencia. Las lecturas y los
 * indicadores de las alertas salen de v_readings_standard (nunca de readings): un indicador
 * de bienestar no puede aparecer. Nada de wellbeing_*, support_*, pvt_* ni escalamientos
 * conductuales; de las alertas, nunca `reason` (lleva el valor).
 */
const { pool } = require('../config/db');

/** Tripulación vigente de la misión (v_current_crew), con su nombre. */
async function currentCrew(missionId, db = pool) {
  const { rows } = await db.query(
    `SELECT astronaut_id, call_sign, full_name, crew_role
     FROM v_current_crew WHERE mission_id = $1
     ORDER BY lower(call_sign), astronaut_id`,
    [missionId],
  );
  return rows;
}

/** Sesión de emergencia abierta (pending o active) de la misión: solo id y estado. */
async function openEmergency(missionId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, status::text AS status FROM emergency_sessions
     WHERE mission_id = $1 AND status IN ('pending', 'active')`,
    [missionId],
  );
  return rows[0] || null;
}

/**
 * Alertas físicas ya escaladas a bordo (level crew) en las últimas `hours` horas: indicador,
 * nivel del semáforo y hora, sin valores. Orden: más reciente primero.
 */
async function crewAlerts({ missionId, astronautIds, hours }, db = pool) {
  const { rows } = await db.query(
    `SELECT e.id AS escalation_id, e.astronaut_id, r.indicator_code, r.indicator_name,
            COALESCE(ev.level, CASE e.priority WHEN 'urgent' THEN 'critical' ELSE 'caution' END)
              AS level,
            e.created_at
     FROM escalations e
     JOIN v_readings_standard r ON r.id = e.source_id
     LEFT JOIN reading_evaluations ev ON ev.reading_id = r.id
     WHERE e.mission_id = $1 AND e.astronaut_id = ANY($2::uuid[])
       AND e.level = 'crew' AND e.category = 'physical' AND e.source_type = 'reading'
       AND NOT e.is_confidential
       AND e.deliver_at IS NOT NULL AND e.deliver_at <= now()
       AND e.created_at >= now() - make_interval(hours => $3)
     ORDER BY e.created_at DESC, e.id`,
    [missionId, astronautIds, hours],
  );
  return rows;
}

/**
 * Última lectura vigente (no corregida) de cada indicador físico estándar de `codes` (los que
 * canAccess deja ver) por astronauta de la misión, con su nivel. Sin el hábitat.
 */
async function latestPhysical({ missionId, astronautIds, codes }, db = pool) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (r.astronaut_id, r.indicator_code)
            r.astronaut_id, r.indicator_code, r.components, r.measured_at, e.level
     FROM v_readings_standard r
     LEFT JOIN reading_evaluations e ON e.reading_id = r.id
     WHERE r.mission_id = $1 AND r.astronaut_id = ANY($2::uuid[])
       AND r.indicator_code = ANY($3::text[])
       AND r.body_zone <> 'environment'
       AND NOT EXISTS (SELECT 1 FROM v_readings_standard s
                       WHERE s.recorded_by = r.recorded_by AND s.supersedes_uuid = r.client_uuid)
     ORDER BY r.astronaut_id, r.indicator_code, r.measured_at DESC, r.received_at DESC, r.id DESC`,
    [missionId, astronautIds, codes],
  );
  return rows;
}

module.exports = { currentCrew, openEmergency, crewAlerts, latestPhysical };
