'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const ISSUER = 'astro-health';
const AUDIENCE = 'astro-health-api';

/**
 * Versión de la contraseña: cambia cada vez que se guarda una contraseña nueva.
 * Va en el claim `pcv`; un token con otra versión deja de servir (cambio o reset).
 */
const passwordVersion = (user) =>
  user.password_changed_at ? new Date(user.password_changed_at).getTime() : 0;

function sign(user, deviceId, scope, expiresIn) {
  return jwt.sign(
    { role: user.role, did: deviceId, pcv: passwordVersion(user), scope },
    env.auth.jwtSecret,
    {
      algorithm: 'HS256',
      subject: user.id,
      expiresIn,
      issuer: ISSUER,
      audience: AUDIENCE,
      jwtid: crypto.randomUUID(),
    },
  );
}

/** Access token de la sesión (JWT_ACCESS_TTL). */
const signAccess = (user, deviceId) => sign(user, deviceId, 'access', env.auth.accessTtlSeconds);

/**
 * Token del 428: solo sirve para POST /auth/change-password. Es de un solo uso
 * porque al cambiar la contraseña cambia `pcv` y el token queda inválido.
 */
const signPasswordChange = (user, deviceId) =>
  sign(user, deviceId, 'password_change', env.auth.passwordChangeTtlSeconds);

/** Verifica firma, algoritmo, emisor, audiencia y vencimiento. Lanza si no es válido. */
const verify = (token) =>
  jwt.verify(token, env.auth.jwtSecret, {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: AUDIENCE,
  });

/** Refresh token opaco (no es JWT). Se entrega una vez; en la base solo va su SHA-256. */
const newRefreshToken = () => `rt_${crypto.randomBytes(32).toString('base64url')}`;
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

module.exports = {
  passwordVersion,
  signAccess,
  signPasswordChange,
  verify,
  newRefreshToken,
  hashToken,
};
