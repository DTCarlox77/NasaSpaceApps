'use strict';

/**
 * Acciones delegadas del comandante (delegated_actions, append-only: un trigger impide UPDATE y
 * DELETE). La entrega a Tierra NO se guarda (reported_to_ground_at no se podría actualizar al
 * cambiar un corte): se DERIVA al leer con compute_deliver_at(misión, received_at), así que un
 * corte que se abre o se cierra después cambia la entrega sin tocar la fila.
 */
const { pool } = require('../config/db');

const DELIVER_AT = 'compute_deliver_at(d.mission_id, d.received_at)';

/** Tripulante vigente de la misión (v_current_crew), por su usuario. */
async function crewMember({ userId, missionId }, db = pool) {
  const { rows } = await db.query(
    `SELECT c.user_id, c.astronaut_id, c.call_sign, c.crew_role, u.username
     FROM v_current_crew c JOIN users u ON u.id = c.user_id
     WHERE c.user_id = $1 AND c.mission_id = $2`,
    [userId, missionId],
  );
  return rows[0] || null;
}

async function insert(
  { missionId, actorUserId, action, targetType, targetId, details, performedAt },
  db = pool,
) {
  const { rows } = await db.query(
    `WITH d AS (
       INSERT INTO delegated_actions (mission_id, actor_user_id, crew_role, action, target_type,
                                      target_id, details, performed_at)
       VALUES ($1, $2, 'commander', $3, $4, $5, $6, $7)
       RETURNING *)
     SELECT d.id, d.performed_at, d.received_at, ${DELIVER_AT} AS deliver_at FROM d`,
    [missionId, actorUserId, action, targetType, targetId, details || {}, performedAt],
  );
  return rows[0];
}

/**
 * Página de la auditoría para Tierra: solo lo que ya llegó (deliver_at derivado <= now()).
 * Orden: performed_at descendente (keyset performed_at, id).
 */
async function groundPage({ missionId, from, to, after, limit }, db = pool) {
  const params = [missionId, from, to, limit + 1];
  let cursorSql = '';
  if (after) {
    params.push(after.p, after.id);
    cursorSql = 'AND (x.performed_at, x.id) < ($5::timestamptz, $6::uuid)';
  }
  const { rows } = await db.query(
    `SELECT x.*, to_char(x.performed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
              AS performed_at_text
     FROM (
       SELECT d.id, d.mission_id, d.actor_user_id, a.call_sign AS actor_call_sign,
              d.crew_role::text AS crew_role, d.action, d.target_type, d.target_id,
              d.performed_at, d.received_at, ${DELIVER_AT} AS deliver_at
       FROM delegated_actions d
       LEFT JOIN astronauts a ON a.user_id = d.actor_user_id
       WHERE d.mission_id = $1
         AND ($2::timestamptz IS NULL OR d.performed_at >= $2)
         AND ($3::timestamptz IS NULL OR d.performed_at < $3)
     ) x
     WHERE x.deliver_at IS NOT NULL AND x.deliver_at <= now() ${cursorSql}
     ORDER BY x.performed_at DESC, x.id DESC
     LIMIT $4`,
    params,
  );
  return rows;
}

/** Borra el PIN offline de todos los dispositivos del usuario (lo restablece). */
async function resetPins({ userId, resetBy }, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE offline_pins
     SET pin_hash = NULL, offline_unlock_until = NULL, reset_at = now(), reset_by = $2
     WHERE user_id = $1 AND pin_hash IS NOT NULL`,
    [userId, resetBy],
  );
  return rowCount;
}

module.exports = { crewMember, insert, groundPage, resetPins };
