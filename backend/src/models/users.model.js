'use strict';

const { pool } = require('../config/db');

// Columnas de UserAdmin (contrato). Nunca incluye password_hash.
const ADMIN_COLUMNS = `id, username, email, full_name, role, must_change_password, is_active,
  failed_login_attempts, locked_until, last_login_at, created_at`;

// Estado necesario para autenticar (incluye el hash: no salir de los servicios).
// is_locked se calcula con el reloj de la base, igual que locked_until.
const AUTH_COLUMNS = `id, username, email, full_name, role, password_hash, must_change_password,
  is_active, failed_login_attempts, locked_until, password_changed_at,
  (locked_until IS NOT NULL AND locked_until > now()) AS is_locked`;

async function findByUsername(username, db = pool) {
  const { rows } = await db.query(
    `SELECT ${AUTH_COLUMNS} FROM users WHERE lower(username) = lower($1)`,
    [username],
  );
  return rows[0] || null;
}

async function findById(id, db = pool) {
  const { rows } = await db.query(`SELECT ${AUTH_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

/**
 * Registra un intento fallido y bloquea la cuenta al llegar al máximo.
 * Se llama solo si la cuenta NO está bloqueada ahora: un locked_until no nulo
 * es un bloqueo ya vencido, así que el contador vuelve a empezar.
 */
async function registerFailedLogin(id, maxAttempts, lockMinutes, db = pool) {
  const { rows } = await db.query(
    `UPDATE users SET
       failed_login_attempts =
         (CASE WHEN locked_until IS NOT NULL THEN 0 ELSE failed_login_attempts END) + 1,
       locked_until = CASE
         WHEN (CASE WHEN locked_until IS NOT NULL THEN 0 ELSE failed_login_attempts END) + 1 >= $2
         THEN now() + make_interval(mins => $3::int)
         ELSE NULL
       END
     WHERE id = $1
     RETURNING failed_login_attempts, locked_until`,
    [id, maxAttempts, lockMinutes],
  );
  return rows[0];
}

async function registerSuccessfulLogin(id, db = pool) {
  await db.query(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now()
     WHERE id = $1`,
    [id],
  );
}

/**
 * Guarda un hash nuevo. password_changed_at cambia siempre: invalida los access
 * tokens anteriores (llevan la versión de la contraseña en el claim pcv).
 */
async function setPassword(id, passwordHash, { mustChange }, db = pool) {
  const { rows } = await db.query(
    `UPDATE users SET password_hash = $2, must_change_password = $3, password_changed_at = now(),
                      failed_login_attempts = 0, locked_until = NULL
     WHERE id = $1
     RETURNING ${AUTH_COLUMNS}`,
    [id, passwordHash, mustChange],
  );
  return rows[0] || null;
}

async function unlock(id, db = pool) {
  const { rows } = await db.query(
    `UPDATE users SET failed_login_attempts = 0, locked_until = NULL
     WHERE id = $1
     RETURNING ${ADMIN_COLUMNS}`,
    [id],
  );
  return rows[0] || null;
}

async function insertUser({ username, email, fullName, passwordHash, role, createdBy }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO users (username, email, full_name, password_hash, role, must_change_password, created_by)
     VALUES ($1, $2, $3, $4, $5, true, $6)
     RETURNING ${ADMIN_COLUMNS}`,
    [username, email || null, fullName, passwordHash, role, createdBy],
  );
  return rows[0];
}

module.exports = {
  findByUsername,
  findById,
  registerFailedLogin,
  registerSuccessfulLogin,
  setPassword,
  unlock,
  insertUser,
};
