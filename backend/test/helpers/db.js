'use strict';
/**
 * Apoyo para las pruebas que usan PostgreSQL.
 *
 * - Usan SIEMPRE la base de pruebas DB_NAME_TEST (por defecto astro_health_test), nunca
 *   la de desarrollo: al cargar este módulo se reemplaza DB_NAME en el proceso, así la app,
 *   migrate.js y seed.js se conectan a la base de pruebas.
 * - Si la base de pruebas no existe, se intenta crear; si el usuario no tiene permiso,
 *   la suite se salta con el comando para crearla.
 * - node --test corre cada archivo en su propio proceso y en paralelo: las suites se turnan
 *   con un advisory lock de PostgreSQL y cada una reinicia la base de pruebas al empezar.
 *
 * Este archivo debe cargarse ANTES que cualquier módulo de src/.
 */
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });
const { Pool } = require('pg');

const DEV_DB = process.env.DB_NAME;
const TEST_DB = (process.env.DB_NAME_TEST || 'astro_health_test').trim();
if (process.env.NODE_ENV !== 'production') process.env.NODE_ENV = 'test';
process.env.DB_NAME = TEST_DB;

const REQUIRED = ['PORT', 'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD'];
const LOCK_KEY = 42420001; // advisory lock compartido por todas las suites de BD
const SAFE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

const createCommand = () =>
  `"C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe" -U postgres -c "CREATE DATABASE ${TEST_DB} OWNER ${process.env.DB_USER}"`;

function poolFor(database) {
  return new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 2000,
    max: 3,
  });
}

/** null si la base de pruebas está lista; si no, el motivo para saltar la suite. */
async function ensureTestDatabase() {
  const probe = poolFor(TEST_DB);
  try {
    await probe.query('SELECT 1');
    return null;
  } catch (err) {
    if (err.code !== '3D000') return `sin conexión a PostgreSQL (${err.code || err.message})`;
  } finally {
    await probe.end().catch(() => {});
  }

  // La base de pruebas no existe: se intenta crear desde la de desarrollo.
  const admin = poolFor(DEV_DB || 'postgres');
  try {
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    return null;
  } catch (err) {
    if (err.code === '42P04' || err.code === '23505') return null; // otra suite la creó
    return (
      `la base de pruebas ${TEST_DB} no existe y el usuario ${process.env.DB_USER} no puede ` +
      `crearla (${err.code || err.message}). Créala una vez como postgres:\n  ${createCommand()}`
    );
  } finally {
    await admin.end().catch(() => {});
  }
}

/**
 * Abre la base de pruebas y toma el lock. Devuelve { db, reason }: db = null si la suite
 * debe saltarse (reason explica por qué).
 */
async function openTestDb() {
  const missing = REQUIRED.filter((k) => !process.env[k] || process.env[k].trim() === '');
  if (missing.length)
    return { db: null, reason: `faltan variables en .env: ${missing.join(', ')}` };
  if (!SAFE_NAME.test(TEST_DB)) return { db: null, reason: `DB_NAME_TEST inválido: ${TEST_DB}` };
  if (TEST_DB === DEV_DB) {
    return { db: null, reason: 'DB_NAME_TEST no puede ser la base de desarrollo (DB_NAME)' };
  }

  const reason = await ensureTestDatabase();
  if (reason) return { db: null, reason };

  const pool = poolFor(TEST_DB);
  let lock;
  try {
    lock = await pool.connect();
    await lock.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  } catch (err) {
    if (lock) lock.release();
    await pool.end().catch(() => {});
    return { db: null, reason: `no se pudo abrir ${TEST_DB} (${err.code || err.message})` };
  }
  return {
    reason: null,
    db: {
      name: TEST_DB,
      pool,
      async close() {
        await lock.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
        lock.release();
        await pool.end();
      },
    },
  };
}

/** Migra desde cero y siembra la base de PRUEBAS (lo mismo que db:reset), sin ruido. */
async function resetDatabase() {
  if (process.env.DB_NAME !== TEST_DB || TEST_DB === DEV_DB) {
    throw new Error('resetDatabase solo corre sobre la base de pruebas');
  }
  const { migrate } = require('../../scripts/migrate');
  const { seed } = require('../../scripts/seed');
  const log = console.log;
  console.log = () => {};
  try {
    await migrate({ reset: true });
    await seed();
  } finally {
    console.log = log;
  }
}

module.exports = { openTestDb, resetDatabase, TEST_DB };
