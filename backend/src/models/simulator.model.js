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
     WHERE source_id = ANY($1::uuid[]) AND NOT is_confidential
     GROUP BY level ORDER BY level`,
    [readingIds],
  );
  return rows;
}

module.exports = { missionByCode, currentCrew, serviceUser, escalationCounts };
