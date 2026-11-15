'use strict';

const { pool } = require('../config/db');

/** Perfil de astronauta y su asignación vigente (v_current_crew), si la hay. */
async function crewContext(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT a.id AS astronaut_id, a.call_sign, a.sex, c.crew_role,
            m.id AS mission_id, m.code AS mission_code, m.name AS mission_name, m.status AS mission_status,
            e.code AS environment_code, e.name AS environment_name, e.type AS environment_type,
            e.gravity_g, e.comm_delay_seconds
     FROM astronauts a
     LEFT JOIN v_current_crew c ON c.astronaut_id = a.id
     LEFT JOIN missions m ON m.id = c.mission_id
     LEFT JOIN environments e ON e.code = m.environment_code
     WHERE a.user_id = $1
     LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

/** Fila de v_current_crew del usuario (para requireCrewRole). */
async function currentCrew(userId, db = pool) {
  const { rows } = await db.query(
    'SELECT mission_id, astronaut_id, call_sign, crew_role FROM v_current_crew WHERE user_id = $1 LIMIT 1',
    [userId],
  );
  return rows[0] || null;
}

/** Misiones del equipo en Tierra del usuario. */
async function groundMissions(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT m.id, m.code, m.name, m.status, g.function
     FROM mission_ground_team g JOIN missions m ON m.id = g.mission_id
     WHERE g.user_id = $1
     ORDER BY m.starts_at DESC`,
    [userId],
  );
  return rows;
}

/** Misión de una cuenta de servicio. */
async function serviceMission(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT m.id, m.code, m.name, m.status
     FROM service_accounts s JOIN missions m ON m.id = s.mission_id
     WHERE s.user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

async function offlineUnlockUntil(userId, deviceId, db = pool) {
  const { rows } = await db.query(
    `SELECT offline_unlock_until FROM offline_pins
     WHERE user_id = $1 AND device_id = $2 AND pin_hash IS NOT NULL`,
    [userId, deviceId],
  );
  return rows[0] ? rows[0].offline_unlock_until : null;
}

/** ¿El astronauta compartió su bienestar con el CMO? Sin fila = no. */
async function sharesWithCmo(astronautId, db = pool) {
  const { rows } = await db.query(
    'SELECT share_with_cmo FROM privacy_preferences WHERE astronaut_id = $1',
    [astronautId],
  );
  return rows[0] ? rows[0].share_with_cmo : false;
}

module.exports = {
  crewContext,
  currentCrew,
  groundMissions,
  serviceMission,
  offlineUnlockUntil,
  sharesWithCmo,
};
