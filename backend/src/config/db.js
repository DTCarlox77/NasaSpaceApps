'use strict';

const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool({
  ...env.db,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[db] Error inesperado en un cliente inactivo del pool:', err.message);
});

/**
 * Ejecuta una consulta parametrizada usando el pool.
 * @param {string} text  SQL con placeholders $1, $2, ...
 * @param {Array} [params]
 */
function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
