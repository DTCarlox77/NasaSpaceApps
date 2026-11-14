'use strict';

/**
 * Autenticación: login con bloqueo, cambio obligatorio de contraseña (428),
 * refresh rotativo con detección de reuso, logout y contexto del usuario.
 * Contrato: tag Auth de docs/openapi.yaml.
 */
const env = require('../config/env');
const { pool } = require('../config/db');
const { HttpError, unauthenticated } = require('../utils/httpError');
const { withTransaction } = require('../models/transaction');
const users = require('../models/users.model');
const refreshTokens = require('../models/refreshTokens.model');
const authEvents = require('../models/authEvents.model');
const contextModel = require('../models/userContext.model');
const passwords = require('./passwords.service');
const tokens = require('./tokens.service');

const GROUND_ROLES = ['flight_surgeon', 'behavioral_health', 'admin'];

// Mismo error si el usuario no existe, está inactivo o la contraseña no coincide.
const invalidCredentials = () =>
  new HttpError(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.');

const accountLocked = (lockedUntil) =>
  new HttpError(
    423,
    'ACCOUNT_LOCKED',
    'Cuenta bloqueada por intentos fallidos. Intenta más tarde o pide al comandante que la desbloquee.',
    { locked_until: new Date(lockedUntil).toISOString() },
  );

/** 428 con un token que solo sirve para POST /auth/change-password. */
function passwordChangeRequired(user, deviceId) {
  return new HttpError(
    428,
    'PASSWORD_CHANGE_REQUIRED',
    'Debes cambiar tu contraseña temporal antes de continuar.',
    {
      password_change_token: tokens.signPasswordChange(user, deviceId),
      expires_in: env.auth.passwordChangeTtlSeconds,
      user_id: user.id,
    },
  );
}

const toIso = (value) => (value ? new Date(value).toISOString() : null);

const userSummary = (u) => ({
  id: u.id,
  username: u.username,
  full_name: u.full_name,
  role: u.role,
  email: u.email ?? null,
});

/** UserContext del contrato según el rol. */
async function buildContext(user, db = pool) {
  const context = { astronaut_id: null, call_sign: null, crew_role: null };
  if (user.role === 'astronaut') {
    const crew = await contextModel.crewContext(user.id, db);
    if (crew) {
      context.astronaut_id = crew.astronaut_id;
      context.call_sign = crew.call_sign;
      if (crew.mission_id) {
        context.crew_role = crew.crew_role;
        context.mission = {
          id: crew.mission_id,
          code: crew.mission_code,
          name: crew.mission_name,
          status: crew.mission_status,
        };
        context.environment = {
          code: crew.environment_code,
          name: crew.environment_name,
          type: crew.environment_type,
          gravity_g: Number(crew.gravity_g),
          comm_delay_seconds: crew.comm_delay_seconds,
        };
      }
    }
  } else if (user.role === 'service') {
    const mission = await contextModel.serviceMission(user.id, db);
    if (mission) context.mission = mission;
  } else if (GROUND_ROLES.includes(user.role)) {
    const missions = await contextModel.groundMissions(user.id, db);
    context.ground_missions = missions.map(({ id, code, name, status }) => ({
      id,
      code,
      name,
      status,
    }));
  }
  return context;
}

function assertAssignment(user, context) {
  if (user.role === 'astronaut' && !context.mission) {
    throw new HttpError(403, 'NO_ACTIVE_ASSIGNMENT', 'No tienes una asignación de misión vigente.');
  }
}

/** Crea el refresh token (se guarda su hash) y firma el access token. */
async function issueSession(user, deviceId, db = pool) {
  const refreshToken = tokens.newRefreshToken();
  await refreshTokens.insert(
    {
      userId: user.id,
      tokenHash: tokens.hashToken(refreshToken),
      deviceId,
      ttlSeconds: env.auth.refreshTtlSeconds,
    },
    db,
  );
  return {
    access_token: tokens.signAccess(user, deviceId),
    token_type: 'Bearer',
    expires_in: env.auth.accessTtlSeconds,
    refresh_token: refreshToken,
  };
}

async function loginResponse(user, deviceId, context) {
  const session = await issueSession(user, deviceId);
  return {
    ...session,
    must_change_password: false,
    offline_unlock_until: toIso(await contextModel.offlineUnlockUntil(user.id, deviceId)),
    user: userSummary(user),
    context,
  };
}

async function login({ username, password, deviceId, ip }) {
  const record = (user, event) =>
    authEvents.record({ userId: user ? user.id : null, username, event, deviceId, ip });

  const user = await users.findByUsername(username);
  if (!user || !user.is_active) {
    await passwords.compare(password, null); // misma duración que con un usuario real
    await record(user, 'login_failed');
    throw invalidCredentials();
  }
  if (user.is_locked) {
    await record(user, 'login_failed');
    throw accountLocked(user.locked_until);
  }
  if (!(await passwords.compare(password, user.password_hash))) {
    const state = await users.registerFailedLogin(
      user.id,
      env.auth.lockoutMaxAttempts,
      env.auth.lockoutMinutes,
    );
    await record(user, 'login_failed');
    if (state.locked_until) {
      await record(user, 'account_locked');
      throw accountLocked(state.locked_until);
    }
    throw invalidCredentials();
  }

  await users.registerSuccessfulLogin(user.id);
  await record(user, 'login_success');
  if (user.must_change_password) throw passwordChangeRequired(user, deviceId);

  const context = await buildContext(user);
  assertAssignment(user, context);
  return loginResponse(user, deviceId, context);
}

async function changePassword({ userId, currentPassword, newPassword, deviceId, ip }) {
  const user = await users.findById(userId);
  if (!user || !user.is_active) throw unauthenticated();
  if (!(await passwords.compare(currentPassword, user.password_hash))) throw invalidCredentials();
  passwords.assertPolicy(newPassword, currentPassword);
  const newHash = await passwords.hash(newPassword);

  // Guarda la contraseña, limpia must_change_password y revoca todas las sesiones anteriores.
  const updated = await withTransaction(async (db) => {
    const row = await users.setPassword(user.id, newHash, { mustChange: false }, db);
    await refreshTokens.revokeForUser(user.id, {}, db);
    await authEvents.record(
      { userId: user.id, username: user.username, event: 'password_changed', deviceId, ip },
      db,
    );
    return row;
  });

  const context = await buildContext(updated);
  assertAssignment(updated, context);
  return loginResponse(updated, deviceId, context);
}

async function refresh({ refreshToken, deviceId, ip }) {
  const outcome = await withTransaction(async (db) => {
    const row = await refreshTokens.findByHashForUpdate(tokens.hashToken(refreshToken), db);
    if (!row) return { error: 'invalid' };

    if (row.revoked_at) {
      // Revocado por logout o cambio de contraseña: solo inválido.
      if (!row.replaced_by) return { error: 'invalid' };
      // Ya se había rotado: alguien lo está reusando. Se revoca la familia y se
      // confirma la transacción antes de responder 401.
      await refreshTokens.revokeFamilyFrom(row.id, db);
      const owner = await users.findById(row.user_id, db);
      await authEvents.record(
        {
          userId: row.user_id,
          username: owner ? owner.username : null,
          event: 'token_reuse_detected',
          deviceId,
          ip,
        },
        db,
      );
      return { error: 'reuse' };
    }
    if (row.expired || row.device_id !== deviceId) return { error: 'invalid' };

    const user = await users.findById(row.user_id, db);
    if (!user || !user.is_active) return { error: 'invalid' };
    if (user.must_change_password) return { error: 'must_change', user };

    const nextToken = tokens.newRefreshToken();
    const inserted = await refreshTokens.insert(
      {
        userId: user.id,
        tokenHash: tokens.hashToken(nextToken),
        deviceId,
        ttlSeconds: env.auth.refreshTtlSeconds,
      },
      db,
    );
    await refreshTokens.markRotated(row.id, inserted.id, db);
    await authEvents.record(
      { userId: user.id, username: user.username, event: 'token_refreshed', deviceId, ip },
      db,
    );
    return { user, nextToken };
  });

  if (outcome.error === 'reuse') {
    throw new HttpError(
      401,
      'TOKEN_REUSE_DETECTED',
      'Se detectó el reuso de un token. Inicia sesión de nuevo.',
      { family_revoked: true },
    );
  }
  if (outcome.error === 'must_change') throw passwordChangeRequired(outcome.user, deviceId);
  if (outcome.error) throw unauthenticated('La sesión expiró. Inicia sesión de nuevo.');

  return {
    access_token: tokens.signAccess(outcome.user, deviceId),
    token_type: 'Bearer',
    expires_in: env.auth.accessTtlSeconds,
    refresh_token: outcome.nextToken,
  };
}

/** Revoca el refresh del dispositivo de la sesión (o de todos con allDevices). */
async function logout({ userId, username, deviceId, allDevices, ip }) {
  await refreshTokens.revokeForUser(userId, { deviceId: allDevices ? null : deviceId || null });
  await authEvents.record({ userId, username, event: 'logout', deviceId, ip });
}

async function me(userId) {
  const user = await users.findById(userId);
  if (!user) throw unauthenticated();
  return { user: userSummary(user), context: await buildContext(user) };
}

module.exports = {
  login,
  changePassword,
  refresh,
  logout,
  me,
  buildContext,
  passwordChangeRequired,
  userSummary,
};
