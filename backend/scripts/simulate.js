'use strict';

/**
 * Simulador de datos SINTÉTICOS (tarea 7), desde la terminal. Escribe en la base de .env
 * (DB_* o DATABASE_URL) por los mismos servicios que la API.
 *
 *   npm run sim:history -- --days 14 --seed 42
 *   npm run sim:scenario -- <solar_event|crew_illness|co2_spike|wellbeing_decline>
 *        [--astronaut VEGA] [--module HAB-2] [--intensity high] [--contagion]
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

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
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
  } else {
    throw new Error('Uso: simulate.js history [--days N] [--seed S] | scenario <nombre> [...]');
  }
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((err) => {
    console.error(`[sim] ${err.message}`);
    if (err.details) console.error(JSON.stringify(err.details, null, 2));
    process.exitCode = 1;
  })
  .finally(() => require('../src/config/db').pool.end());
