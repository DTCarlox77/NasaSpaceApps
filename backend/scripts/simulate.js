'use strict';

/**
 * Simulador de datos SINTÉTICOS (tarea 7), desde la terminal. Escribe en la base de .env
 * (DB_* o DATABASE_URL) por los mismos servicios que la API.
 *
 *   npm run sim:history -- --days 14 --seed 42
 *   npm run sim:scenario -- <solar_event|crew_illness|co2_spike|wellbeing_decline|offline_batch>
 *        [--astronaut VEGA] [--module HAB-2] [--intensity high] [--contagion]
 *   npm run sim:offline-batch -- [--astronaut ORION]          (lo empuja por /sync/push)
 *   npm run sim:offline-batch -- --dry-run [--now ISO] [--out docs/examples/sync-push.json]
 *        (solo arma el lote: no toca la base)
 *
 * Con NODE_ENV=production solo corre si SIMULATOR_ENABLED=true (igual que los endpoints).
 */
const env = require('../src/config/env');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

const toInt = (value) => (value === undefined ? undefined : Number(value));

/** Arma el lote de offline_batch sin base de datos (para el ejemplo del contrato y la app). */
function dryRunOfflineBatch(args) {
  const fs = require('node:fs');
  const path = require('node:path');
  const { buildScenario } = require('../src/simulator/scenarios');
  const astronaut = typeof args.astronaut === 'string' ? args.astronaut.toUpperCase() : 'ORION';
  const now = typeof args.now === 'string' ? new Date(args.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('--now debe ser una fecha ISO 8601.');
  const scenario = buildScenario('offline_batch', {
    now,
    crew: [{ call_sign: astronaut }],
    astronaut,
  });
  const json = `${JSON.stringify(scenario.items[0].body, null, 2)}
`;
  if (typeof args.out === 'string') {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, json);
    console.error(`[sim] Lote de ejemplo en ${args.out}`);
  } else process.stdout.write(json);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (command === 'offline-batch' && args['dry-run']) return dryRunOfflineBatch(args);
  if (env.nodeEnv === 'production' && !env.simulatorEnabled) {
    throw new Error('En producción el simulador necesita SIMULATOR_ENABLED=true.');
  }
  const simulator = require('../src/services/simulator.service');
  let summary;
  if (command === 'history') {
    summary = await simulator.loadHistory({
      body: { days: toInt(args.days), seed: toInt(args.seed) },
    });
  } else if (command === 'scenario') {
    summary = await simulator.runScenario({
      name: args._[0],
      body: {
        astronaut: args.astronaut,
        module_id: args.module,
        intensity: args.intensity,
        contagion: args.contagion === undefined ? undefined : args.contagion === true,
      },
    });
  } else if (command === 'offline-batch') {
    summary = await simulator.runScenario({
      name: 'offline_batch',
      body: { astronaut: args.astronaut },
    });
  } else {
    throw new Error(
      'Uso: simulate.js history [--days N] [--seed S] | scenario <nombre> [...] | offline-batch [...]',
    );
  }
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((err) => {
    console.error(`[sim] ${err.message}`);
    if (err.details) console.error(JSON.stringify(err.details, null, 2));
    process.exitCode = 1;
  })
  .finally(() => {
    // El modo --dry-run no abre la base.
    const cached = require.cache[require.resolve('../src/config/db')];
    if (cached) return cached.exports.pool.end();
    return undefined;
  });
