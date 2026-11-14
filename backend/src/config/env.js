'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const REQUIRED = ['PORT', 'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];

const missing = REQUIRED.filter((key) => !process.env[key] || process.env[key].trim() === '');
if (missing.length > 0) {
  console.error(`[env] Faltan variables de entorno obligatorias: ${missing.join(', ')}`);
  console.error('[env] Copia .env.example a .env y completa los valores.');
  process.exit(1);
}

function toPort(name) {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    console.error(
      `[env] ${name} debe ser un puerto válido (1-65535), recibido: "${process.env[name]}"`,
    );
    process.exit(1);
  }
  return value;
}

const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toPort('PORT'),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  db: Object.freeze({
    host: process.env.DB_HOST,
    port: toPort('DB_PORT'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  }),
});

module.exports = env;
