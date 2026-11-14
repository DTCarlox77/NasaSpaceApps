'use strict';
/**
 * Apoyo para las pruebas que usan PostgreSQL.
 *
 * node --test corre cada archivo en su propio proceso y en paralelo. Las suites
 * que reinician la base (db:reset) y las que la leen se turnan con un advisory
 * lock de PostgreSQL: cada suite lo toma en before() y lo suelta en after().
 *
 * Si no hay .env o no hay conexión, openTestDb() devuelve null y la suite se salta.
 */
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });
const { Pool } = require('pg');

const REQUIRED = ['PORT', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const LOCK_KEY = 42420001; // advisory lock compartido por todas las suites de BD
const SKIP_REASON = 'sin conexión a PostgreSQL (configura .env y corre npm run db:reset)';

async function openTestDb() {
  if (REQUIRED.some((k) => !process.env[k] || process.env[k].trim() === '')) return null;
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 2000,
    max: 3,
  });
  let lock;
  try {
    lock = await pool.connect();
    await lock.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  } catch {
    if (lock) lock.release();
    await pool.end().catch(() => {});
    return null;
  }
  return {
    pool,
    async close() {
      await lock.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
      lock.release();
      await pool.end();
    },
  };
}

/** Migra desde cero y siembra (lo mismo que npm run db:reset), sin ruido en la salida. */
async function resetDatabase() {
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

module.exports = { openTestDb, resetDatabase, SKIP_REASON };
