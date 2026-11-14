'use strict';

const { pool } = require('../config/db');

/**
 * Ejecuta fn(client) dentro de una transacción: COMMIT si termina bien y
 * ROLLBACK si lanza. Los modelos reciben `db` (pool o client) para poder
 * participar en la misma transacción.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { withTransaction };
