'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

// Con DATABASE_URL (Render, Railway) no hacen falta las DB_*; sin ella, sí.
const hasDatabaseUrl = Boolean((process.env.DATABASE_URL || '').trim());
const REQUIRED = hasDatabaseUrl
  ? ['PORT']
  : ['PORT', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
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

function toOptionalDate(name) {
  const raw = (process.env[name] || '').trim();
  if (raw === '') return null;
  const value = new Date(raw);
  if (Number.isNaN(value.getTime()))
    fail(`${name} debe ser una fecha ISO 8601, recibido: "${raw}"`);
  return value;
}

const nodeEnv = process.env.NODE_ENV || 'development';

function toBoolean(name, fallback) {
  const raw = (process.env[name] || '').trim().toLowerCase();
  if (raw === '') return fallback;
  if (['true', '1', 'yes'].includes(raw)) return true;
  if (['false', '0', 'no'].includes(raw)) return false;
  return fail(`${name} debe ser true o false, recibido: "${process.env[name]}"`);
}

/**
 * SSL de PostgreSQL (DB_SSL):
 * - false: sin SSL (por defecto con DB_*; la base local no lo usa);
 * - no-verify: SSL sin verificar el certificado (por defecto con DATABASE_URL: Render y
 *   Railway usan certificados que no están en la cadena de Node);
 * - true: SSL verificando el certificado.
 */
function dbSsl() {
  const raw = (process.env.DB_SSL || (hasDatabaseUrl ? 'no-verify' : 'false')).trim().toLowerCase();
  if (raw === 'false') return false;
  if (raw === 'no-verify') return { rejectUnauthorized: false };
  if (raw === 'true') return { rejectUnauthorized: true };
  return fail(`DB_SSL debe ser false, no-verify o true, recibido: "${process.env.DB_SSL}"`);
}

function dbConfig() {
  const ssl = dbSsl();
  if (hasDatabaseUrl) {
    return Object.freeze({ connectionString: process.env.DATABASE_URL.trim(), ssl });
  }
  return Object.freeze({
    host: process.env.DB_HOST,
    port: toPort('DB_PORT'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl,
  });
}

/** CORS_ORIGIN: "*" o varias URLs separadas por coma (sin barra final). */
function corsOrigin() {
  const raw = (process.env.CORS_ORIGIN || '*').trim();
  if (raw === '*') return '*';
  const list = raw
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (list.length === 0) return '*';
  return list.length === 1 ? list[0] : list;
}

/** trust proxy: saltos de proxy delante de la app (Render/Railway = 1). */
function trustProxy() {
  const raw = (process.env.TRUST_PROXY || '').trim();
  if (raw === '') return nodeEnv === 'production' ? 1 : false;
  if (raw === 'false' || raw === '0') return false;
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 1) {
    fail(`TRUST_PROXY debe ser false o un entero >= 1, recibido: "${raw}"`);
  }
  return hops;
}

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
  corsOrigin: corsOrigin(),
  trustProxy: trustProxy(),
  // Seed de demo (datos sintéticos) permitido en producción solo con DEMO_SEED=true.
  demoSeed: toBoolean('DEMO_SEED', false),
  // Simulador de demo (POST /admin/simulator/*): sin SIMULATOR_ENABLED=true las rutas dan 404.
  simulatorEnabled: toBoolean('SIMULATOR_ENABLED', false),
  db: dbConfig(),
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
  sync: Object.freeze({
    // POST /sync/push: máximo de items por lote (más → 413).
    maxBatch: toPositiveInt('SYNC_MAX_BATCH', 500),
    // measured_at (o created_at) en el futuro más allá de esto → rejected (también en línea).
    maxFutureSkewS: toPositiveInt('SYNC_MAX_FUTURE_SKEW_S', 300, { min: 0 }),
    // Una lectura registrada más de esto después de medirse se marca late_sync.
    lateAfterS: toPositiveInt('SYNC_LATE_AFTER_S', 900),
    // GET /sync/pull: solo devuelve cambios con más de esta antigüedad (ms), para que una
    // transacción que confirma tarde no quede detrás del cursor.
    pullSettleMs: toPositiveInt('SYNC_PULL_SETTLE_MS', 2000, { min: 0 }),
  }),
  triage: Object.freeze({
    // Activaciones automáticas de la emergencia (el botón manual siempre funciona).
    autoEnabled: toBoolean('TRIAGE_AUTO_ENABLED', true),
    autoCriticalReading: toBoolean('TRIAGE_AUTO_CRITICAL_READING', true),
    autoMissedCheckin: toBoolean('TRIAGE_AUTO_MISSED_CHECKIN', true),
    // Una lectura crítica más vieja que esto (min) escala, pero no abre la emergencia.
    autoReadingMaxAgeMin: toPositiveInt('TRIAGE_AUTO_READING_MAX_AGE_MIN', 120),
    // Horas sin check-in para activar por check-in perdido.
    autoMissedCheckinH: toPositiveInt('TRIAGE_AUTO_MISSED_CHECKIN_H', 30),
    // Desde cuándo cuenta el check-in perdido (ISO 8601). Además cuenta desde la última
    // carga de la historia del simulador. Sin ninguna de las dos, no se detecta.
    autoSince: toOptionalDate('TRIAGE_AUTO_SINCE'),
    // Segundos que tiene el tripulante afectado para responder "estoy bien".
    deadmanSeconds: toPositiveInt('TRIAGE_DEADMAN_S', 60),
    // Cada cuánto corre el barrido del hombre muerto en el servidor (0 = no corre).
    sweepIntervalS: toPositiveInt('TRIAGE_SWEEP_INTERVAL_S', 15, { min: 0 }),
  }),
  health: Object.freeze({
    // Prescripción semanal de ejercicio para EXERCISE_MIN (rolling_7d_pct_of_prescription).
    exerciseWeeklyPrescriptionMin: toPositiveInt('EXERCISE_WEEKLY_PRESCRIPTION_MIN', 600),
  }),
});

module.exports = env;
