'use strict';

/**
 * Ejecuta en orden los archivos .sql de db/seeds, cada uno en su propia transacción.
 * Los seeds deben ser idempotentes (p. ej. INSERT ... ON CONFLICT DO NOTHING).
 * Los seeds traen usuarios y credenciales de demo: nunca corren en producción.
 */

const path = require('path');
const env = require('../src/config/env');
const { pool } = require('../src/config/db');
const { listSqlFiles, readSql } = require('./sqlFiles');

const SEEDS_DIR = path.join(__dirname, '../db/seeds');

async function seed() {
  if (env.nodeEnv === 'production') {
    throw new Error(
      'db:seed está deshabilitado con NODE_ENV=production (los seeds son datos de demo)',
    );
  }
  const files = listSqlFiles(SEEDS_DIR);
  if (files.length === 0) {
    console.log('[seed] No hay seeds para ejecutar.');
    return;
  }

  const client = await pool.connect();
  try {
    for (const file of files) {
      try {
        await client.query('BEGIN');
        await client.query(readSql(SEEDS_DIR, file));
        await client.query('COMMIT');
        console.log(`[seed] Ejecutado: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falló el seed ${file}: ${err.message}`, { cause: err });
      }
    }
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seed()
    .then(() => pool.end())
    .catch(async (err) => {
      console.error(`[seed] ${err.message}`);
      await pool.end();
      process.exit(1);
    });
}

module.exports = { seed };
