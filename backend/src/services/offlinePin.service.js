'use strict';

/**
 * PIN de desbloqueo sin conexión (tarea 11, PUT /me/offline-pin).
 *
 * - El astronauta define o cambia su PIN por dispositivo (el de su sesión). El servidor guarda
 *   SOLO el hash bcrypt (offline_pins.pin_hash) y devuelve offline_unlock_until =
 *   ahora + OFFLINE_UNLOCK_DAYS. Cada login en línea en ese dispositivo renueva la ventana.
 * - La verificación sin conexión la hace la APP con su propio verificador local (PBKDF2 con sal
 *   aleatoria del dispositivo, parámetros en `offline_verifier`). El servidor nunca devuelve el
 *   PIN ni su hash.
 * - El PIN NUNCA da acceso al servidor: ningún endpoint lo acepta como credencial. Al reconectar,
 *   la app necesita un login o un refresh válido antes de sincronizar.
 * - Un PIN nuevo reemplaza al anterior. El comandante (POST /crew/users/{id}/reset-pin) o la
 *   revocación de la tableta lo borran: offline_unlock_until vuelve null y la app debe pedir otro.
 */
const env = require('../config/env');
const { pool } = require('../config/db');
const { HttpError, badRequest } = require('../utils/httpError');
const { withTransaction } = require('../models/transaction');
const authEvents = require('../models/authEvents.model');
const passwords = require('./passwords.service');
const { loadActor } = require('./accessPolicy');

const PIN_RE = /^[0-9]{4,8}$/;

/**
 * Parámetros del verificador local de la app (regla de diseño): PBKDF2-HMAC-SHA256 con
 * 600 000 iteraciones (OWASP Password Storage Cheat Sheet) y una sal aleatoria de 16 bytes
 * generada en el dispositivo; tras LOCKOUT_MAX_ATTEMPTS fallos, la app borra el verificador y
 * exige un login en línea.
 */
const offlineVerifier = () => ({
  kdf: 'PBKDF2-HMAC-SHA256',
  iterations: 600000,
  salt_bytes: 16,
  max_attempts: env.auth.lockoutMaxAttempts,
});

/** Guarda el hash y abre la ventana de desbloqueo (upsert por usuario + dispositivo). */
async function savePin({ userId, deviceId, pinHash, days }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO offline_pins (user_id, device_id, pin_hash, offline_unlock_until, failed_attempts)
     VALUES ($1, $2, $3, now() + make_interval(days => $4::int), 0)
     ON CONFLICT (user_id, device_id) DO UPDATE
       SET pin_hash = EXCLUDED.pin_hash,
           offline_unlock_until = EXCLUDED.offline_unlock_until,
           failed_attempts = 0
     RETURNING device_id, offline_unlock_until`,
    [userId, deviceId, pinHash, days],
  );
  return rows[0];
}

/** ¿Ese dispositivo es una tableta revocada de su misión? (no se define PIN ahí). */
async function revokedTablet({ deviceId, missionId }, db = pool) {
  const { rows } = await db.query(
    `SELECT 1 FROM devices WHERE mission_id = $1 AND lower(label) = lower($2) AND status = 'revoked'`,
    [missionId, deviceId],
  );
  return rows.length > 0;
}

/**
 * Renueva la ventana del PIN en un login en línea (si hay PIN en ese dispositivo). Devuelve
 * offline_unlock_until o null (sin PIN o restablecido).
 */
async function renewOnLogin({ userId, deviceId }, db = pool) {
  const { rows } = await db.query(
    `UPDATE offline_pins
     SET offline_unlock_until = now() + make_interval(days => $3::int)
     WHERE user_id = $1 AND device_id = $2 AND pin_hash IS NOT NULL
     RETURNING offline_unlock_until`,
    [userId, deviceId, env.auth.offlineUnlockDays],
  );
  return rows[0] ? rows[0].offline_unlock_until : null;
}

/** PUT /me/offline-pin */
async function setPin({ auth, body, ip }) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const problems = [];
  if (typeof input.pin !== 'string' || !PIN_RE.test(input.pin)) {
    problems.push({ field: 'pin', issue: 'debe tener entre 4 y 8 dígitos' });
  }
  if (
    typeof input.device_id !== 'string' ||
    !input.device_id.trim() ||
    input.device_id.length > 100
  ) {
    problems.push({ field: 'device_id', issue: 'es obligatorio (hasta 100 caracteres)' });
  }
  if (problems.length) throw badRequest(problems);

  const actor = await loadActor(auth.userId);
  if (!actor || actor.role !== 'astronaut' || !actor.mission_ids.length) {
    throw new HttpError(403, 'NO_ACTIVE_ASSIGNMENT', 'No tienes una asignación de misión vigente.');
  }
  // El PIN es del dispositivo de la sesión: no se define a distancia para otro.
  if (input.device_id !== auth.deviceId) {
    throw new HttpError(
      403,
      'DEVICE_NOT_OWNED',
      'El PIN se define en el dispositivo con el que iniciaste sesión.',
      { device_id: input.device_id },
    );
  }
  if (await revokedTablet({ deviceId: input.device_id, missionId: actor.mission_ids[0] })) {
    throw new HttpError(403, 'DEVICE_REVOKED', 'Esta tableta fue revocada.');
  }
  const pinHash = await passwords.hash(input.pin);
  const saved = await withTransaction(async (db) => {
    const row = await savePin(
      {
        userId: actor.user_id,
        deviceId: input.device_id,
        pinHash,
        days: env.auth.offlineUnlockDays,
      },
      db,
    );
    await authEvents.record(
      {
        userId: actor.user_id,
        username: actor.username,
        event: 'offline_pin_set',
        deviceId: input.device_id,
        ip,
      },
      db,
    );
    return row;
  });
  return {
    device_id: saved.device_id,
    offline_unlock_until: new Date(saved.offline_unlock_until).toISOString(),
    offline_verifier: offlineVerifier(),
  };
}

module.exports = { setPin, renewOnLogin, offlineVerifier, PIN_RE };
