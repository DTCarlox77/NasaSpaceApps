'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const REQUIRED = ['PORT', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
// Entornos donde se permite un JWT_SECRET de desarrollo si no se define uno.
const DEV_LIKE = ['development', 'test'];
const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-no-usar-fuera-de-desarrollo';

const missing = REQUIRED.filter((key) => !process.env[key] || process.env[key].trim() === '');
if (missing.length > 0) {
  console.error(`[env] Faltan variables de entorno obligatorias: ${missing.join(', ')}`);
  console.error('[env] Copia .env.example a .env y completa los valores.');
  process.exit(1);
}

function fail(message) {
  console.error(`[env] ${message}`);
  process.exit(1);
}

function toPort(name) {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    fail(`${name} debe ser un puerto válido (1-65535), recibido: "${process.env[name]}"`);
  }
  return value;
}

function toPositiveInt(name, fallback, { min = 1 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    fail(`${name} debe ser un entero >= ${min}, recibido: "${raw}"`);
  }
  return value;
}

// Duraciones como "15m", "7d", "3600s" o "12h" → segundos.
const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 };
function toDurationSeconds(name, fallback) {
  const raw = (process.env[name] || fallback).trim();
  const match = /^(\d+)([smhd])$/.exec(raw);
  if (!match || Number(match[1]) <= 0) {
    fail(`${name} debe ser una duración como 15m, 12h o 7d, recibido: "${raw}"`);
  }
  return Number(match[1]) * UNIT_SECONDS[match[2]];
}

const nodeEnv = process.env.NODE_ENV || 'development';

function jwtSecret() {
  const value = (process.env.JWT_SECRET || '').trim();
  if (value) {
    if (!DEV_LIKE.includes(nodeEnv) && value.length < 32) {
      fail('JWT_SECRET debe tener al menos 32 caracteres fuera de development/test');
    }
    return value;
  }
  if (!DEV_LIKE.includes(nodeEnv)) fail('JWT_SECRET es obligatorio fuera de development/test');
  return DEV_JWT_SECRET;
}

const env = Object.freeze({
  nodeEnv,
  port: toPort('PORT'),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  db: Object.freeze({
    host: process.env.DB_HOST,
    port: toPort('DB_PORT'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  }),
  auth: Object.freeze({
    jwtSecret: jwtSecret(),
    accessTtlSeconds: toDurationSeconds('JWT_ACCESS_TTL', '15m'),
    refreshTtlSeconds: toDurationSeconds('JWT_REFRESH_TTL', '7d'),
    // Token del 428: solo sirve para POST /auth/change-password.
    passwordChangeTtlSeconds: 600,
    lockoutMaxAttempts: toPositiveInt('LOCKOUT_MAX_ATTEMPTS', 5),
    lockoutMinutes: toPositiveInt('LOCKOUT_MINUTES', 15),
    tempPasswordLength: toPositiveInt('TEMP_PASSWORD_LENGTH', 12, { min: 10 }),
    loginRateLimitPerMinute: toPositiveInt('RATE_LIMIT_LOGIN_PER_MINUTE', 30),
  }),
});

module.exports = env;
