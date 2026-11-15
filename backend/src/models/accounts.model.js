'use strict';

const { pool } = require('../config/db');

async function findMission(id, db = pool) {
  const { rows } = await db.query('SELECT id, code, status FROM missions WHERE id = $1', [id]);
  return rows[0] || null;
}

/** Misiones activas del equipo en Tierra de un usuario (destino por defecto de un alta). */
async function activeGroundMissionIds(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT m.id FROM mission_ground_team g JOIN missions m ON m.id = g.mission_id
     WHERE g.user_id = $1 AND m.status = 'active'`,
    [userId],
  );
  return rows.map((r) => r.id);
}

// Sin `sex`: estas respuestas van a admin, que lo escribe pero no lo recibe.
const ASTRONAUT_COLUMNS = 'id, user_id, call_sign, agency, synthetic';

async function insertAstronaut({ userId, callSign, agency, sex }, db) {
  const { rows } = await db.query(
    `INSERT INTO astronauts (user_id, call_sign, agency, sex)
     VALUES ($1, $2, $3, $4)
     RETURNING ${ASTRONAUT_COLUMNS}`,
    [userId, callSign, agency || null, sex || null],
  );
  return rows[0];
}

/** Cambia el sexo biológico del perfil (null lo borra). Devuelve el perfil sin `sex`. */
async function updateAstronautSex(astronautId, sex, db = pool) {
  const { rows } = await db.query(
    `UPDATE astronauts SET sex = $2 WHERE id = $1 RETURNING ${ASTRONAUT_COLUMNS}`,
    [astronautId, sex],
  );
  return rows[0] || null;
}

async function insertAssignment({ missionId, astronautId, crewRole, createdBy }, db) {
  const { rows } = await db.query(
    `INSERT INTO crew_assignments (mission_id, astronaut_id, crew_role, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, mission_id, astronaut_id, crew_role, assigned_from, assigned_to, created_at`,
    [missionId, astronautId, crewRole, createdBy],
  );
  return rows[0];
}

/** Agrega al equipo en Tierra; la función (operations|medical|behavioral) la deriva el trigger del rol. */
async function addToGroundTeam(missionIds, userId, db) {
  for (const missionId of missionIds) {
    await db.query(
      'INSERT INTO mission_ground_team (mission_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [missionId, userId],
    );
  }
}

async function insertServiceAccount({ userId, missionId, description }, db) {
  await db.query(
    'INSERT INTO service_accounts (user_id, mission_id, description) VALUES ($1, $2, $3)',
    [userId, missionId, description],
  );
}

module.exports = {
  findMission,
  activeGroundMissionIds,
  insertAstronaut,
  updateAstronautSex,
  insertAssignment,
  addToGroundTeam,
  insertServiceAccount,
};
