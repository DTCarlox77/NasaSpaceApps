'use strict';

/**
 * Reinicio de la demo desde la terminal (tarea 12). Mismo servicio que POST /admin/demo/reset:
 * recarga la historia de ARES-1, cierra emergencias, cortes, escalamientos y solicitudes de
 * apoyo abiertos, deja listos los usuarios del seed y la aptitud (3 aptos, 1 no confirmado).
 * Datos SINTÉTICOS; no borra nada. Escribe en la base de .env (DB_* o DATABASE_URL).
 *
 *   npm run demo:reset -- --confirm ARES-1 [--days 14] [--seed 42]
 *
 * Se niega (código 1, sin tocar la base):
 * - sin --confirm ARES-1;
 * - con NODE_ENV=test (las pruebas usan el servicio contra astro_health_test, nunca esto);
 * - con NODE_ENV=production fuera del modo demo (SIMULATOR_ENABLED=true y DEMO_SEED=true).
 * En Render (sin consola) usa el endpoint: ver README ("Día de la demo").
 */

const CONFIRM = 'ARES-1';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.slice(2).split('=', 2);
    if (inline !== undefined) args[key] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
      args[key] = argv[i + 1];
      i += 1;
    } else args[key] = true;
  }
  return args;
}

function refuse(message) {
  console.error(`[demo:reset] ${message}`);
  process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.confirm !== CONFIRM) {
    return refuse(
      `Falta la confirmación. Uso: npm run demo:reset -- --confirm ${CONFIRM} [--days 14] [--seed 42]`,
    );
  }
  const env = require('../src/config/env');
  if (env.nodeEnv === 'test') {
    return refuse('No corre con NODE_ENV=test: las pruebas usan el servicio sobre su propia base.');
  }
  if (env.nodeEnv !== 'development' && !env.demoMode) {
    return refuse(
      `Con NODE_ENV=${env.nodeEnv} solo corre en modo demo (SIMULATOR_ENABLED=true y DEMO_SEED=true).`,
    );
  }
  const toInt = (v) => (v === undefined ? undefined : Number(v));
  const { resetDemo } = require('../src/services/demoReset.service');
  const { pool } = require('../src/config/db');
  try {
    console.error('[demo:reset] Reiniciando la demo de ARES-1 (puede tardar ~1 min)...');
    const summary = await resetDemo({
      body: { confirm: args.confirm, days: toInt(args.days), seed: toInt(args.seed) },
    });
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    refuse(err.message);
    if (err.details) console.error(JSON.stringify(err.details, null, 2));
  } finally {
    await pool.end();
  }
  return undefined;
}

main();
