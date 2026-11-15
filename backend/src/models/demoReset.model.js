'use strict';

/**
 * Consultas del reinicio de demo (src/services/demoReset.service.js). Nada se borra: las
 * sesiones, cortes, escalamientos y solicitudes se cierran; las tablas append-only no se tocan.
 */
const { pool } = require('../config/db');

/** Sesiones de emergencia abiertas (pending | active) de la misión. */
async function openSessionIds(missionId, db = pool) {
  const { rows } = await db.query(
    `SELECT id FROM emergency_sessions
     WHERE mission_id = $1 AND status IN ('pending', 'active')
     ORDER BY received_at`,
    [missionId],
  );
  return rows.map((r) => r.id);
}

/** Cortes de enlace en curso (empezaron y no terminaron) y cuántos hay programados a futuro. */
async function outages(missionId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, starts_at, (starts_at > now()) AS scheduled
     FROM mission_comm_outages
     WHERE mission_id = $1 AND (ends_at IS NULL OR ends_at > now())
     ORDER BY starts_at`,
    [missionId],
  );
  return {
    open: rows.filter((r) => !r.scheduled),
    scheduled: rows.filter((r) => r.scheduled).length,
  };
}

/**
 * Cierra los escalamientos abiertos de la misión (físicos, de emergencia y conductuales).
 * Devuelve cuántos de cada clase: el servicio solo informa los que admin puede ver.
 */
async function closeEscalations(missionId, userId, db = pool) {
  const { rows } = await db.query(
    `WITH closed AS (
       UPDATE escalations
       SET status = 'closed', closed_at = now(), closed_by = $2
       WHERE mission_id = $1 AND status <> 'closed'
       RETURNING is_confidential, category
     )
     SELECT count(*) FILTER (WHERE NOT is_confidential AND category <> 'behavioral')::int AS visible,
            count(*)::int AS total
     FROM closed`,
    [missionId, userId],
  );
  return rows[0];
}

/** Cierra las solicitudes de apoyo abiertas de la misión (confidencial: no se informa). */
async function closeSupportRequests(missionId, userId, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE support_requests
     SET status = 'closed', closed_at = now(), closed_by = $2
     WHERE mission_id = $1 AND status <> 'closed'`,
    [missionId, userId],
  );
  return rowCount;
}

async function usersByIds(ids, db = pool) {
  const { rows } = await db.query(
    `SELECT id, username, password_hash, must_change_password, is_active,
            failed_login_attempts, locked_until, (locked_until > now()) AS locked
     FROM users WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return rows;
}

/** Usuario listo: activo, sin intentos fallidos ni bloqueo. */
async function readyUser(id, db = pool) {
  await db.query(
    `UPDATE users SET is_active = true, failed_login_attempts = 0, locked_until = NULL
     WHERE id = $1`,
    [id],
  );
}

/**
 * Contraseña del seed otra vez. password_changed_at cambia (o vuelve a NULL si el seed exige
 * cambiarla en el primer login): los access tokens anteriores dejan de servir (claim pcv).
 */
async function restorePassword({ id, passwordHash, mustChange }, db = pool) {
  await db.query(
    `UPDATE users
     SET password_hash = $2, must_change_password = $3,
         password_changed_at = CASE WHEN $3 THEN NULL ELSE now() END
     WHERE id = $1`,
    [id, passwordHash, mustChange],
  );
}

async function setMustChange(id, mustChange, db = pool) {
  await db.query('UPDATE users SET must_change_password = $2 WHERE id = $1', [id, mustChange]);
}

module.exports = {
  openSessionIds,
  outages,
  closeEscalations,
  closeSupportRequests,
  usersByIds,
  readyUser,
  restorePassword,
  setMustChange,
};
