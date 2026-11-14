'use strict';

const { query } = require('../config/db');
const { version } = require('../../package.json');

async function getHealth(req, res) {
  let dbStatus = 'up';
  try {
    await query('SELECT 1');
  } catch (err) {
    dbStatus = 'down';
    console.error('[health] La base de datos no responde:', err.message);
  }

  res.status(dbStatus === 'up' ? 200 : 503).json({
    status: dbStatus === 'up' ? 'ok' : 'error',
    db: dbStatus,
    time: new Date().toISOString(),
    version,
  });
}

module.exports = { getHealth };
