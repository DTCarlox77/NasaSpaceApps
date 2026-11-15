'use strict';

/**
 * Consultas del simulador de demo: misión, tripulación vigente, cuenta de servicio del
 * hábitat y resumen de los escalamientos creados. No escribe: las lecturas entran por los
 * servicios de lecturas, hábitat y bienestar.
 */
const { pool } = require('../config/db');

async function missionByCode(code, db = pool) {
  const { rows } = await db.query(
    'SELECT id, code, status, starts_at, ends_at FROM missions WHERE code = $1',
    [code],
  );
  return rows[0] || null;
}

/** Tripulación vigente (v_current_crew) con el usuario de cada astronauta. */
async function currentCrew(missionId, db = pool) {
  const { rows } = await db.query(
    `SELECT c.user_id, c.astronaut_id, c.call_sign, c.crew_role
     FROM v_current_crew c JOIN users u ON u.id = c.user_id
     WHERE c.mission_id = $1 AND u.is_active
     ORDER BY c.call_sign`,
    [missionId],
  );
  return rows;
}

/** Cuenta de servicio (sensores del hábitat) de la misión. */
async function serviceUser(missionId, db = pool) {
  const { rows } = await db.query(
    `SELECT u.id FROM service_accounts s JOIN users u ON u.id = s.user_id
     WHERE s.mission_id = $1 AND u.role = 'service' AND u.is_active
     ORDER BY u.username LIMIT 1`,
    [missionId],
  );
  return rows[0] ? rows[0].id : null;
}

/** Escalamientos NO confidenciales creados por estas lecturas, por nivel. */
async function escalationCounts(readingIds, db = pool) {
  if (!readingIds.length) return [];
  const { rows } = await db.query(
    `SELECT level::text AS level, count(*)::int AS count
     FROM escalations
     WHERE source_id = ANY($1::uuid[]) AND NOT is_confidential AND category <> 'behavioral'
     GROUP BY level ORDER BY level`,
    [readingIds],
  );
  return rows;
}

/**
 * Radiación vigente (sin corregidas) por astronauta: la última RAD_DOSE_CUM y las dosis de
 * evento (RAD_DOSE_DAILY con event_active). Uso interno del simulador para que la acumulada
 * incluya los eventos solares.
 */
async function radiationState(astronautIds, db = pool) {
  const notSuperseded = `NOT EXISTS (SELECT 1 FROM readings s
    WHERE s.recorded_by = r.recorded_by AND s.supersedes_uuid = r.client_uuid)`;
  const [cumulative, events] = await Promise.all([
    db.query(
      `SELECT DISTINCT ON (r.astronaut_id) r.astronaut_id, (r.components->>'value')::float8 AS value,
              r.measured_at
       FROM readings r
       WHERE r.astronaut_id = ANY($1::uuid[]) AND r.indicator_code = 'RAD_DOSE_CUM'
         AND ${notSuperseded}
       ORDER BY r.astronaut_id, r.measured_at DESC`,
      [astronautIds],
    ),
    db.query(
      `SELECT r.astronaut_id, (r.components->>'value')::float8 AS value, r.measured_at
       FROM readings r
       WHERE r.astronaut_id = ANY($1::uuid[]) AND r.indicator_code = 'RAD_DOSE_DAILY'
         AND (r.components->>'event_active')::boolean IS TRUE AND ${notSuperseded}
       ORDER BY r.measured_at`,
      [astronautIds],
    ),
  ]);
  const state = new Map(astronautIds.map((id) => [id, { last: null, events: [] }]));
  for (const row of cumulative.rows) state.get(row.astronaut_id).last = row;
  for (const row of events.rows) state.get(row.astronaut_id).events.push(row);
  return state;
}

/** ¿Hay un corte de enlace en curso en la misión? */
async function activeOutage(missionId, db = pool) {
  const { rows } = await db.query(
    `SELECT id FROM mission_comm_outages
     WHERE mission_id = $1 AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())`,
    [missionId],
  );
  return rows[0] || null;
}

/** Fin del último corte ya cerrado (o null): un corte nuevo no puede empezar antes. */
async function lastOutageEnd(missionId, db = pool) {
  const { rows } = await db.query(
    `SELECT max(ends_at) AS ends_at FROM mission_comm_outages
     WHERE mission_id = $1 AND ends_at IS NOT NULL AND ends_at <= now()`,
    [missionId],
  );
  return rows[0].ends_at;
}

module.exports = {
  missionByCode,
  currentCrew,
  serviceUser,
  escalationCounts,
  radiationState,
  activeOutage,
  lastOutageEnd,
};
