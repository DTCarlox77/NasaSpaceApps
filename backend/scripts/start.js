'use strict';

/**
 * Arranque de despliegue (Render/Railway): migraciones pendientes, seed de demo solo si
 * DEMO_SEED=true y luego el servidor. Lo usa `npm run start:deploy`.
 * En el plan gratuito de Render no hay "pre-deploy command", por eso se migra al arrancar.
 */
const { migrate } = require('./migrate');
const { seed } = require('./seed');

async function main() {
  await migrate();
  await seed({ ifDemo: true });
  require('../src/server');
}

main().catch((err) => {
  console.error(`[start] No se pudo arrancar: ${err.message}`);
  process.exit(1);
});
