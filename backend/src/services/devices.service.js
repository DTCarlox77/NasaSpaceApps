'use strict';

/**
 * Tabletas de la misión y su credencial (tarea 11).
 *
 * Credencial: `dc_` + 32 bytes aleatorios (crypto.randomBytes) en base64url (46 caracteres).
 * Se devuelve UNA sola vez al registrar; en la base solo queda su SHA-256 en hex (es un valor
 * aleatorio de alta entropía, no una contraseña: no hace falta bcrypt). Nunca se escribe en un
 * log, en auth_events ni en otra respuesta.
 *
 * Con X-Device-Credential una tableta activa de una misión activa opera SOLO el triaje de su
 * misión (deviceActor). Credencial desconocida, revocada o de una misión que no está activa →
 * 401 INVALID_DEVICE_CREDENTIAL (mismo mensaje en todos los casos) y queda en auth_events
 * (device_auth_failed, con la IP). Los fallos se limitan por IP
 * (RATE_LIMIT_DEVICE_CREDENTIAL_PER_MINUTE, en memoria: una sola instancia).
 */
const crypto = require('node:crypto');
const env = require('../config/env');
const { HttpError, badRequest, conflict, notFound } = require('../utils/httpError');
const { validate, uuidParam } = require('../utils/validate');
const { withTransaction } = require('../models/transaction');
const devices = require('../models/devices.model');
const missions = require('../models/missions.model');
const authEvents = require('../models/authEvents.model');

const CREDENTIAL_PREFIX = 'dc_';
const WINDOW_MS = 60 * 1000;

const generateCredential = () =>
  `${CREDENTIAL_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
const hashCredential = (credential) =>
  crypto.createHash('sha256').update(String(credential), 'utf8').digest('hex');

/** Device del contrato (sin hash ni credencial). */
const toDevice = (row) => ({
  id: row.id,
  label: row.label,
  kind: row.kind,
  mission_id: row.mission_id,
  module_id: row.module_id,
  registered_by: row.registered_by,
  registered_via: row.registered_via,
  status: row.status,
  created_at: row.created_at,
  last_seen_at: row.last_seen_at,
  revoked_at: row.revoked_at,
});

// ---------------------------------------------------------------- límite de fallos por IP

const failures = new Map();

/** Segundos que faltan si la IP ya agotó sus fallos en la ventana; 0 si puede intentar. */
function blockedFor(ip, now = Date.now()) {
  const entry = failures.get(ip);
  if (!entry || entry.resetAt <= now) return 0;
  return entry.count >= env.auth.deviceCredentialFailuresPerMinute
    ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    : 0;
}

function countFailure(ip, now = Date.now()) {
  if (failures.size > 10000) {
    for (const [key, entry] of failures) if (entry.resetAt <= now) failures.delete(key);
  }
  let entry = failures.get(ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    failures.set(ip, entry);
  }
  entry.count += 1;
}

/** Solo para las pruebas: vacía el contador en memoria. */
const resetFailureLimiter = () => failures.clear();

const invalidCredential = () =>
  new HttpError(401, 'INVALID_DEVICE_CREDENTIAL', 'La credencial de la tableta no es válida.');

/**
 * Valida X-Device-Credential. Devuelve { id, label, mission_id } o lanza 401 (y registra el
 * fallo). El límite por IP lo revisa el middleware antes de llamar (blockedFor).
 */
async function authenticate({ credential, ip }) {
  const value = typeof credential === 'string' ? credential.trim() : '';
  const row =
    value.length >= 10 && value.length <= 200
      ? await devices.findByCredentialHash(hashCredential(value))
      : null;
  if (!row || row.status !== 'active' || row.mission_status !== 'active') {
    countFailure(ip);
    await authEvents.record({ event: 'device_auth_failed', deviceId: row ? row.id : null, ip });
    throw invalidCredential();
  }
  await devices.touch(row.id);
  return { id: row.id, label: row.label, mission_id: row.mission_id };
}

// ---------------------------------------------------------------- registro y revocación

function validateDeviceBody(body, { withMission }) {
  const v = validate(body)
    .string('label', { max: 40 })
    .string('module_id', { required: false, max: 40 });
  if (withMission) v.uuid('mission_id');
  const input = v.check();
  if (!input.label.trim()) throw badRequest([{ field: 'label', issue: 'no puede estar vacío' }]);
  return {
    label: input.label.trim(),
    module_id: input.module_id ?? null,
    mission_id: input.mission_id,
  };
}

/**
 * Registra una tableta (dentro de `db`). Devuelve { device, credential }: la credencial en
 * claro existe solo en esta respuesta.
 */
async function register({ missionId, label, moduleId, actor, via, ip }, db) {
  if (await devices.findByLabel(missionId, label, db)) {
    throw conflict('DEVICE_LABEL_TAKEN', `Ya hay una tableta "${label}" en la misión.`, { label });
  }
  const credential = generateCredential();
  const row = await devices.insert(
    {
      label,
      missionId,
      moduleId,
      credentialHash: hashCredential(credential),
      registeredBy: actor.user_id,
      registeredVia: via,
    },
    db,
  );
  await authEvents.record(
    {
      userId: actor.user_id,
      username: actor.username,
      event: 'device_registered',
      deviceId: row.id,
      ip,
    },
    db,
  );
  return { device: toDevice(row), credential };
}

/** POST /admin/devices */
async function adminRegister({ actor, body, ip }) {
  const input = validateDeviceBody(body, { withMission: true });
  const mission = await missions.findMission(input.mission_id);
  if (!mission) throw notFound('La misión no existe.');
  return withTransaction((db) =>
    register(
      {
        missionId: mission.id,
        label: input.label,
        moduleId: input.module_id,
        actor,
        via: 'admin',
        ip,
      },
      db,
    ),
  );
}

/** GET /admin/devices?mission_id=&include_revoked= */
async function adminList({ query }) {
  if (query.include_revoked !== undefined && !['true', 'false'].includes(query.include_revoked)) {
    throw badRequest([{ field: 'include_revoked', issue: 'debe ser true o false' }]);
  }
  const missionId =
    query.mission_id === undefined ? null : uuidParam(query.mission_id, 'mission_id');
  const rows = await devices.list({ missionId, includeRevoked: query.include_revoked === 'true' });
  return { items: rows.map(toDevice) };
}

/**
 * POST /admin/devices/{id}/revoke: la credencial deja de servir de inmediato y se invalidan
 * los PIN offline definidos en esa tableta. Idempotente.
 */
async function adminRevoke({ actor, id, ip }) {
  const deviceId = uuidParam(id);
  return withTransaction(async (db) => {
    const current = await devices.findById(deviceId, db);
    if (!current) throw notFound('La tableta no existe.');
    if (current.status === 'revoked') return toDevice(current);
    const row = await devices.revoke(deviceId, db);
    await devices.invalidatePins(
      { label: row.label, missionId: row.mission_id, resetBy: actor.user_id },
      db,
    );
    await authEvents.record(
      {
        userId: actor.user_id,
        username: actor.username,
        event: 'device_revoked',
        deviceId: row.id,
        ip,
      },
      db,
    );
    return toDevice(row);
  });
}

module.exports = {
  authenticate,
  blockedFor,
  resetFailureLimiter,
  register,
  adminRegister,
  adminList,
  adminRevoke,
  validateDeviceBody,
  hashCredential,
  generateCredential,
  toDevice,
  CREDENTIAL_PREFIX,
};
