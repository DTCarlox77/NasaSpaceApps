'use strict';

const { pool } = require('../config/db');

/**
 * Bitácora de autenticación. Eventos válidos: ver el CHECK de auth_events
 * (migraciones 001 y 007).
 */
async function record(
  { userId = null, username = null, event, deviceId = null, ip = null },
  db = pool,
) {
  await db.query(
    `INSERT INTO auth_events (user_id, username, event, device_id, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, username, event, deviceId, ip],
  );
}

module.exports = { record };
