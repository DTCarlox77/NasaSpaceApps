'use strict';

/**
 * Aplica en orden los archivos .sql de db/migrations.
 * Cada archivo se ejecuta en su propia transacción y se registra en schema_migrations,
 * de modo que volver a ejecutar el script no reaplica nada.
 *
 * Uso:
 *   node scripts/migrate.js           -> aplica migraciones pendientes
 *   node scripts/migrate.js --reset   -> borra el schema public y migra desde cero
 */

const path = require('path');
const env = require('../src/config/env');
const { pool } = require('../src/config/db');
const { listSqlFiles, readSql } = require('./sqlFiles');

const MIGRATIONS_DIR = path.join(__dirname, '../db/migrations');

async function resetSchema(client) {
  if (env.nodeEnv === 'production') {
    throw new Error('db:reset está deshabilitado con NODE_ENV=production');
  }
  console.log('[migrate] Borrando schema public...');
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
}

async function migrate({ reset = false } = {}) {
  const client = await pool.connect();
  try {
    if (reset) await resetSchema(client);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));
    const pending = listSqlFiles(MIGRATIONS_DIR).filter((file) => !applied.has(file));

    if (pending.length === 0) {
      console.log('[migrate] No hay migraciones pendientes.');
      return;
    }

    for (const file of pending) {
      const sql = readSql(MIGRATIONS_DIR, file);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[migrate] Aplicada: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falló la migración ${file}: ${err.message}`, { cause: err });
      }
    }
    console.log(`[migrate] ${pending.length} migración(es) aplicada(s).`);
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate({ reset: process.argv.includes('--reset') })
    .then(() => pool.end())
    .catch(async (err) => {
      console.error(`[migrate] ${err.message}`);
      await pool.end();
      process.exit(1);
    });
}

module.exports = { migrate };
