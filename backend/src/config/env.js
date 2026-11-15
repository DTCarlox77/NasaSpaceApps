'use strict';

/**
 * Configuración del proceso: carga backend/.env (sin pisar variables ya definidas) y la valida
 * con loadEnv (src/config/loadEnv.js). Si algo falla, explica el motivo y termina con código 1:
 * el servidor no arranca con una configuración insegura o incompleta.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const { loadEnv, ConfigError } = require('./loadEnv');

let env;
try {
  env = loadEnv(process.env);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  for (const line of err.message.split('\n')) console.error(`[env] ${line}`);
  process.exit(1);
}

module.exports = env;
