'use strict';

/**
 * Lee y valida las variables de entorno. Es pura: recibe las variables (process.env en
 * src/config/env.js) y devuelve la configuración congelada, o lanza ConfigError con el motivo.
 * src/config/env.js termina el proceso con ese mensaje; las pruebas la llaman directamente.
 *
 * Fuera de development/test (producción, staging...) el servidor no arranca con:
 * - JWT_SECRET vacío, corto (< 32), el de desarrollo o con pinta de ejemplo;
 * - CORS_ORIGIN vacío o "*" (hay que listar los orígenes del panel y de Expo web).
 * Los mensajes nunca incluyen el valor de un secreto.
 */

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

// Entornos donde se permite un JWT_SECRET de desarrollo y CORS_ORIGIN=*.
const DEV_LIKE = ['development', 'test'];
const DEV_JWT_SECRET = 'dev-only-insecure-jwt-secret-no-usar-fuera-de-desarrollo';
const JWT_MIN_LENGTH = 32;
const JWT_MIN_DISTINCT_CHARS = 10;
// Palabras de los valores de ejemplo o por defecto ("changeme", "secret", "ejemplo"...).
const JWT_PLACEHOLDER =
  /change|cambia|example|ejemplo|placeholder|secret|default|dev-only|insecure|password|contrase/i;
const JWT_HOWTO =
  "Genera uno con: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"";
// PIN offline: piso de las iteraciones de PBKDF2 del verificador local (regla de diseño).
const OFFLINE_PIN_ITERATIONS_MIN = 10000;
const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 };

function loadEnv(vars = {}) {
  const fail = (message) => {
    throw new ConfigError(message);
  };
  const read = (name) => (vars[name] === undefined ? undefined : String(vars[name]));
  const nodeEnv = (read('NODE_ENV') || 'development').trim();
  const devLike = DEV_LIKE.includes(nodeEnv);

  // Con DATABASE_URL (Render, Railway) no hacen falta las DB_*; sin ella, sí.
  const hasDatabaseUrl = Boolean((read('DATABASE_URL') || '').trim());
  const required = hasDatabaseUrl
    ? ['PORT']
    : ['PORT', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const missing = required.filter((key) => !read(key) || read(key).trim() === '');
  if (missing.length > 0) {
    fail(
      `Faltan variables de entorno obligatorias: ${missing.join(', ')}\n` +
        'Copia .env.example a .env y completa los valores.',
    );
  }

  function toPort(name) {
    const value = Number(read(name));
    if (!Number.isInteger(value) || value <= 0 || value > 65535) {
      fail(`${name} debe ser un puerto válido (1-65535), recibido: "${read(name)}"`);
    }
    return value;
  }

  function toPositiveInt(name, fallback, { min = 1 } = {}) {
    const raw = read(name);
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
      fail(`${name} debe ser un entero >= ${min}, recibido: "${raw}"`);
    }
    return value;
  }

  // Duraciones como "15m", "7d", "3600s" o "12h" → segundos.
  function toDurationSeconds(name, fallback) {
    const raw = (read(name) || fallback).trim();
    const match = /^(\d+)([smhd])$/.exec(raw);
    if (!match || Number(match[1]) <= 0) {
      fail(`${name} debe ser una duración como 15m, 12h o 7d, recibido: "${raw}"`);
    }
    return Number(match[1]) * UNIT_SECONDS[match[2]];
  }

  function toOptionalDate(name) {
    const raw = (read(name) || '').trim();
    if (raw === '') return null;
    const value = new Date(raw);
    if (Number.isNaN(value.getTime()))
      fail(`${name} debe ser una fecha ISO 8601, recibido: "${raw}"`);
    return value;
  }

  function toBoolean(name, fallback) {
    const raw = (read(name) || '').trim().toLowerCase();
    if (raw === '') return fallback;
    if (['true', '1', 'yes'].includes(raw)) return true;
    if (['false', '0', 'no'].includes(raw)) return false;
    return fail(`${name} debe ser true o false, recibido: "${read(name)}"`);
  }

  /**
   * SSL de PostgreSQL (DB_SSL):
   * - false: sin SSL (por defecto con DB_*; la base local no lo usa);
   * - no-verify: SSL sin verificar el certificado (por defecto con DATABASE_URL: Render y
   *   Railway usan certificados que no están en la cadena de Node);
   * - true: SSL verificando el certificado.
   */
  function dbSsl() {
    const raw = (read('DB_SSL') || (hasDatabaseUrl ? 'no-verify' : 'false')).trim().toLowerCase();
    if (raw === 'false') return false;
    if (raw === 'no-verify') return { rejectUnauthorized: false };
    if (raw === 'true') return { rejectUnauthorized: true };
    return fail(`DB_SSL debe ser false, no-verify o true, recibido: "${read('DB_SSL')}"`);
  }

  function dbConfig() {
    const ssl = dbSsl();
    if (hasDatabaseUrl) {
      return Object.freeze({ connectionString: read('DATABASE_URL').trim(), ssl });
    }
    return Object.freeze({
      host: read('DB_HOST'),
      port: toPort('DB_PORT'),
      database: read('DB_NAME'),
      user: read('DB_USER'),
      password: read('DB_PASSWORD'),
      ssl,
    });
  }

  /**
   * CORS_ORIGIN: "*" (solo en development/test) o varios orígenes separados por coma
   * (esquema://host[:puerto], sin ruta). Las apps nativas no mandan Origin y no lo necesitan;
   * el panel y Expo web sí. Un origen que no está en la lista no recibe
   * Access-Control-Allow-Origin y el navegador bloquea la respuesta.
   */
  function corsOrigin() {
    const raw = (read('CORS_ORIGIN') || '').trim();
    if (raw === '' || raw === '*') {
      if (!devLike) {
        fail(
          `CORS_ORIGIN no puede ser "*" ni quedar vacío con NODE_ENV=${nodeEnv}: pon los orígenes ` +
            'del panel (y de Expo web) separados por coma, p. ej. ' +
            'https://panel.example.com,http://localhost:8081',
        );
      }
      return '*';
    }
    const list = raw
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean);
    const invalid = [];
    const origins = [];
    for (const item of list) {
      const origin = normalizeOrigin(item);
      if (origin) origins.push(origin);
      else invalid.push(item);
    }
    if (invalid.length) {
      fail(
        `CORS_ORIGIN tiene valores que no son un origen (${invalid.join(', ')}): usa ` +
          'esquema://host[:puerto] sin ruta, separados por coma (y nunca "*" en la lista).',
      );
    }
    const unique = [...new Set(origins)];
    if (unique.length === 0) return devLike ? '*' : fail('CORS_ORIGIN no tiene orígenes válidos');
    return unique.length === 1 ? unique[0] : unique;
  }

  /** trust proxy: saltos de proxy delante de la app (Render/Railway/ngrok = 1). */
  function trustProxy() {
    const raw = (read('TRUST_PROXY') || '').trim();
    if (raw === '') return nodeEnv === 'production' ? 1 : false;
    if (raw === 'false' || raw === '0') return false;
    const hops = Number(raw);
    if (!Number.isInteger(hops) || hops < 1) {
      fail(`TRUST_PROXY debe ser false o un entero >= 1, recibido: "${raw}"`);
    }
    return hops;
  }

  /** El valor nunca sale en un mensaje: solo el motivo. */
  function jwtSecret() {
    const value = (read('JWT_SECRET') || '').trim();
    if (devLike) return value || DEV_JWT_SECRET;
    if (!value) fail(`JWT_SECRET es obligatorio con NODE_ENV=${nodeEnv}. ${JWT_HOWTO}`);
    if (value.length < JWT_MIN_LENGTH) {
      fail(`JWT_SECRET debe tener al menos ${JWT_MIN_LENGTH} caracteres. ${JWT_HOWTO}`);
    }
    if (
      value === DEV_JWT_SECRET ||
      JWT_PLACEHOLDER.test(value) ||
      new Set(value).size < JWT_MIN_DISTINCT_CHARS
    ) {
      fail(`JWT_SECRET es un valor por defecto, de ejemplo o débil. ${JWT_HOWTO}`);
    }
    return value;
  }

  const simulatorEnabled = toBoolean('SIMULATOR_ENABLED', false);
  const demoSeed = toBoolean('DEMO_SEED', false);

  return Object.freeze({
    nodeEnv,
    port: toPort('PORT'),
    corsOrigin: corsOrigin(),
    trustProxy: trustProxy(),
    // Seed de demo (datos sintéticos) permitido en producción solo con DEMO_SEED=true.
    demoSeed,
    // Simulador de demo (POST /admin/simulator/*): sin SIMULATOR_ENABLED=true las rutas dan 404.
    simulatorEnabled,
    // Modo demo (POST /admin/demo/reset): el simulador encendido y, fuera de
    // development/test, además DEMO_SEED=true (la base solo tiene datos sintéticos).
    demoMode: simulatorEnabled && (devLike || demoSeed),
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
      // Credenciales de tableta inválidas (X-Device-Credential) por IP y minuto; más → 429.
      deviceCredentialFailuresPerMinute: toPositiveInt(
        'RATE_LIMIT_DEVICE_CREDENTIAL_PER_MINUTE',
        10,
      ),
      // PIN offline: días de desbloqueo sin conexión desde el último login (o cambio de PIN).
      offlineUnlockDays: toPositiveInt('OFFLINE_UNLOCK_DAYS', 7),
      // PIN offline: iteraciones de PBKDF2 del verificador local de la app (offline_verifier).
      // 600 000 = OWASP para PBKDF2-HMAC-SHA256; bájalo solo si la app tarda demasiado.
      offlinePinIterations: toPositiveInt('OFFLINE_PIN_PBKDF2_ITERATIONS', 600000, {
        min: OFFLINE_PIN_ITERATIONS_MIN,
      }),
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
    // Bienestar (tarea 10). Todas son reglas de diseño (basis: design_rule), no umbrales clínicos.
    wellbeing: Object.freeze({
      // Un solo escalamiento conductual abierto por astronauta e indicador: mientras
      // behavioral_health no lo cierre, un cambio que sigue sostenido no vuelve a escalar.
      oneOpenEscalation: toBoolean('WELLBEING_ONE_OPEN_ESCALATION', true),
      // Aptitud para tarea crítica: solo cuenta una PVT de las últimas N horas; sin PVT
      // reciente → not_confirmed (dashboard y cumplimiento).
      fitnessMaxAgeH: toPositiveInt('WELLBEING_FITNESS_MAX_AGE_H', 12),
      // PHQ-2 y GAD-2 cada N días, un día antes de la conferencia psicológica (screening_due).
      screeningEveryDays: toPositiveInt('WELLBEING_SCREENING_EVERY_DAYS', 14, { min: 2 }),
    }),
  });
}

/** "https://Panel.example.com:443" → "https://panel.example.com"; null si no es un origen. */
function normalizeOrigin(value) {
  if (value === '*') return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
  return url.origin;
}

module.exports = {
  loadEnv,
  ConfigError,
  DEV_LIKE,
  DEV_JWT_SECRET,
  OFFLINE_PIN_ITERATIONS_MIN,
};
