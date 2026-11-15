'use strict';

const { pool } = require('../config/db');

/** confidential_access_log es append-only (migración 006): solo se inserta. */
async function insert(
  { actorUserId, actorUsername, actorRole, astronautId, resource, action = 'read', ip = null },
  db = pool,
) {
  const { rows } = await db.query(
    `INSERT INTO confidential_access_log
       (actor_user_id, actor_username, actor_role, astronaut_id, resource, action, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, accessed_at`,
    [actorUserId, actorUsername, actorRole, astronautId, resource, action, ip],
  );
  return rows[0];
}

/**
 * Página de la bitácora (sin el contenido ni la IP), de lo más reciente a lo más antiguo.
 * missionId: solo astronautas asignados a esa misión (cualquier periodo). astronautId: solo él.
 */
async function page({ missionId = null, astronautId = null, from, to, after, limit }, db = pool) {
  const params = [missionId, astronautId, from, to, limit + 1];
  let cursorSql = '';
  if (after) {
    params.push(after.t, after.id);
    cursorSql = 'AND (l.accessed_at, l.id) < ($6::timestamptz, $7::uuid)';
  }
  const { rows } = await db.query(
    `SELECT l.id, l.actor_user_id, l.actor_username, l.actor_role::text AS actor_role,
            l.astronaut_id, a.call_sign, l.resource, l.accessed_at,
            to_char(l.accessed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_text
     FROM confidential_access_log l
     JOIN astronauts a ON a.id = l.astronaut_id
     WHERE ($1::uuid IS NULL OR l.astronaut_id IN (SELECT ca.astronaut_id FROM crew_assignments ca
                                                    WHERE ca.mission_id = $1))
       AND ($2::uuid IS NULL OR l.astronaut_id = $2)
       AND ($3::timestamptz IS NULL OR l.accessed_at >= $3)
       AND ($4::timestamptz IS NULL OR l.accessed_at < $4)
       ${cursorSql}
     ORDER BY l.accessed_at DESC, l.id DESC
     LIMIT $5`,
    params,
  );
  return rows;
}

module.exports = { insert, page };
