'use strict';

const { pool } = require('../config/db');

// Solo se guarda el SHA-256 del token, nunca el token.

async function insert({ userId, tokenHash, deviceId, ttlSeconds }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_id, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4::int))
     RETURNING id, expires_at`,
    [userId, tokenHash, deviceId, ttlSeconds],
  );
  return rows[0];
}

async function findByHashForUpdate(tokenHash, db) {
  const { rows } = await db.query(
    `SELECT id, user_id, device_id, expires_at, revoked_at, replaced_by, expires_at <= now() AS expired
     FROM refresh_tokens WHERE token_hash = $1
     FOR UPDATE`,
    [tokenHash],
  );
  return rows[0] || null;
}

/** Marca el token como rotado (revocado y reemplazado por newId). */
async function markRotated(id, newId, db) {
  await db.query(
    `UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2
     WHERE id = $1 AND revoked_at IS NULL`,
    [id, newId],
  );
}

/**
 * Revoca la familia a partir de un token reusado: él y todos los que lo
 * reemplazaron después (cadena replaced_by). Devuelve cuántos seguían activos.
 */
async function revokeFamilyFrom(id, db = pool) {
  const { rowCount } = await db.query(
    `WITH RECURSIVE family AS (
       SELECT id, replaced_by FROM refresh_tokens WHERE id = $1
       UNION ALL
       SELECT t.id, t.replaced_by FROM refresh_tokens t JOIN family f ON t.id = f.replaced_by
     )
     UPDATE refresh_tokens SET revoked_at = now()
     WHERE id IN (SELECT id FROM family) AND revoked_at IS NULL`,
    [id],
  );
  return rowCount;
}

/** Revoca los tokens activos del usuario (de un dispositivo o de todos). */
async function revokeForUser(userId, { deviceId = null } = {}, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR device_id = $2)`,
    [userId, deviceId],
  );
  return rowCount;
}

module.exports = { insert, findByHashForUpdate, markRotated, revokeFamilyFrom, revokeForUser };
