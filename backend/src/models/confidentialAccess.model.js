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

module.exports = { insert };
