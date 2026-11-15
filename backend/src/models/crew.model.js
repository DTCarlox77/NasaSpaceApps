'use strict';

/** Tripulación vigente de una misión (v_current_crew), con el sexo del perfil para filtrarlo. */
const { pool } = require('../config/db');

async function missionExists(missionId, db = pool) {
  const { rows } = await db.query('SELECT 1 FROM missions WHERE id = $1', [missionId]);
  return rows.length > 0;
}

/** Página ordenada por call_sign e id (keyset). Devuelve limit + 1 filas. */
async function currentCrewPage({ missionId, after, limit }, db = pool) {
  const { rows } = await db.query(
    `SELECT c.astronaut_id, c.user_id, c.call_sign, c.full_name, c.crew_role, c.assigned_from,
            a.sex
     FROM v_current_crew c JOIN astronauts a ON a.id = c.astronaut_id
     WHERE c.mission_id = $1
       AND ($2::text IS NULL OR (lower(c.call_sign), c.astronaut_id) > (lower($2), $3::uuid))
     ORDER BY lower(c.call_sign), c.astronaut_id
     LIMIT $4`,
    [missionId, after ? after.c : null, after ? after.id : null, limit + 1],
  );
  return rows;
}

module.exports = { missionExists, currentCrewPage };
