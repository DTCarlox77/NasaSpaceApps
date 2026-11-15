'use strict';

/**
 * Tabletas registradas por misión (migración 007). De la credencial solo se guarda su SHA-256
 * (credential_hash): NUNCA sale de este módulo ni se devuelve en una respuesta.
 */
const { pool } = require('../config/db');

// Columnas públicas (Device del contrato): sin credential_hash.
const DEVICE_COLUMNS = `d.id, d.label, d.kind, d.mission_id, d.module_id, d.registered_by,
  d.registered_via, d.status, d.created_at, d.last_seen_at, d.revoked_at`;

/** Tableta por el hash de su credencial (activa o no), con el estado de su misión. */
async function findByCredentialHash(credentialHash, db = pool) {
  const { rows } = await db.query(
    `SELECT ${DEVICE_COLUMNS}, m.status AS mission_status
     FROM devices d JOIN missions m ON m.id = d.mission_id
     WHERE d.credential_hash = $1`,
    [credentialHash],
  );
  return rows[0] || null;
}

async function touch(id, db = pool) {
  await db.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [id]);
}

async function insert(
  { label, missionId, moduleId, credentialHash, registeredBy, registeredVia },
  db = pool,
) {
  const { rows } = await db.query(
    `WITH d AS (
       INSERT INTO devices (label, mission_id, module_id, credential_hash, registered_by, registered_via)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *)
     SELECT ${DEVICE_COLUMNS} FROM d`,
    [label, missionId, moduleId ?? null, credentialHash, registeredBy, registeredVia],
  );
  return rows[0];
}

async function findById(id, db = pool) {
  const { rows } = await db.query(`SELECT ${DEVICE_COLUMNS} FROM devices d WHERE d.id = $1`, [id]);
  return rows[0] || null;
}

/** ¿Ya hay una tableta con esa etiqueta en la misión? (índice único devices_label_uq). */
async function findByLabel(missionId, label, db = pool) {
  const { rows } = await db.query(
    `SELECT ${DEVICE_COLUMNS} FROM devices d WHERE d.mission_id = $1 AND lower(d.label) = lower($2)`,
    [missionId, label],
  );
  return rows[0] || null;
}

/** Lista para el panel (sin hash). missionId null = todas; activas primero. */
async function list({ missionId, includeRevoked }, db = pool) {
  const { rows } = await db.query(
    `SELECT ${DEVICE_COLUMNS} FROM devices d
     WHERE ($1::uuid IS NULL OR d.mission_id = $1)
       AND ($2::boolean OR d.status = 'active')
     ORDER BY d.mission_id, d.status, lower(d.label)`,
    [missionId, includeRevoked],
  );
  return rows;
}

/** Revoca (idempotente: una revocada queda igual). */
async function revoke(id, db = pool) {
  const { rows } = await db.query(
    `WITH d AS (
       UPDATE devices SET status = 'revoked', revoked_at = COALESCE(revoked_at, now())
       WHERE id = $1
       RETURNING *)
     SELECT ${DEVICE_COLUMNS} FROM d`,
    [id],
  );
  return rows[0] || null;
}

/**
 * Invalida los PIN offline definidos en esa tableta (offline_pins.device_id = la etiqueta)
 * por la tripulación de su misión. Devuelve cuántos.
 */
async function invalidatePins({ label, missionId, resetBy }, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE offline_pins p
     SET pin_hash = NULL, offline_unlock_until = NULL, reset_at = now(), reset_by = $3
     WHERE lower(p.device_id) = lower($1) AND p.pin_hash IS NOT NULL
       AND p.user_id IN (SELECT a.user_id FROM crew_assignments ca
                         JOIN astronauts a ON a.id = ca.astronaut_id
                         WHERE ca.mission_id = $2)`,
    [label, missionId, resetBy],
  );
  return rowCount;
}

module.exports = {
  findByCredentialHash,
  touch,
  insert,
  findById,
  findByLabel,
  list,
  revoke,
  invalidatePins,
};
