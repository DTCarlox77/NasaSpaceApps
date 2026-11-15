'use strict';

/**
 * Consultas del dashboard de tripulación (GET /admin/dashboard/crew).
 * REGLA: las lecturas salen SIEMPRE de v_readings_standard (nunca de readings): los
 * indicadores confidenciales no pueden aparecer. De bienestar solo se lee un agregado que la
 * matriz permite a admin: cuántos check-ins hubo (no su contenido). La aptitud sale de
 * wellbeing.service (fitnessByAstronaut: pvt_runs.fitness de una PVT reciente).
 */
const { pool } = require('../config/db');

/** Tripulación vigente de la misión (v_current_crew). */
async function currentCrew(missionId, db = pool) {
  const { rows } = await db.query(
    `SELECT astronaut_id, call_sign, crew_role, assigned_from
     FROM v_current_crew WHERE mission_id = $1
     ORDER BY call_sign`,
    [missionId],
  );
  return rows;
}

/**
 * Últimas `perIndicator` lecturas vigentes (no corregidas) por astronauta e indicador físico,
 * con su nivel. Solo los indicadores de `codes` (los que canAccess deja ver en el dashboard).
 * Orden: astronauta, indicador y measured_at ascendente.
 */
async function recentPhysicalReadings({ missionId, astronautIds, codes, perIndicator }, db = pool) {
  const { rows } = await db.query(
    `SELECT astronaut_id, indicator_code, components, measured_at, level FROM (
       SELECT r.astronaut_id, r.indicator_code, r.components, r.measured_at, e.level,
              row_number() OVER (PARTITION BY r.astronaut_id, r.indicator_code
                                 ORDER BY r.measured_at DESC, r.received_at DESC, r.id DESC) AS rn
       FROM v_readings_standard r
       LEFT JOIN reading_evaluations e ON e.reading_id = r.id
       WHERE r.mission_id = $1 AND r.astronaut_id = ANY($2::uuid[])
         AND r.body_zone <> 'environment'
         AND r.indicator_code = ANY($4::text[])
         AND NOT EXISTS (SELECT 1 FROM v_readings_standard s
                         WHERE s.recorded_by = r.recorded_by AND s.supersedes_uuid = r.client_uuid)
     ) x
     WHERE rn <= $3
     ORDER BY astronaut_id, indicator_code, measured_at`,
    [missionId, astronautIds, perIndicator, codes],
  );
  return rows;
}

/** Días UTC con check-in en los últimos 7 días, por astronauta (solo el conteo). */
async function checkinDays7d(astronautIds, db = pool) {
  const { rows } = await db.query(
    `SELECT astronaut_id,
            count(DISTINCT (measured_at AT TIME ZONE 'UTC')::date)::int AS days
     FROM wellbeing_checkins
     WHERE astronaut_id = ANY($1::uuid[]) AND measured_at >= now() - interval '7 days'
     GROUP BY astronaut_id`,
    [astronautIds],
  );
  return new Map(rows.map((r) => [r.astronaut_id, r.days]));
}

module.exports = { currentCrew, recentPhysicalReadings, checkinDays7d };
