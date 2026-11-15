'use strict';

const env = require('./config/env');
const app = require('./app');
const { pool } = require('./config/db');

const server = app.listen(env.port, () => {
  console.log(`[server] Escuchando en http://localhost:${env.port} (${env.nodeEnv})`);
  console.log(`[server] Documentación en http://localhost:${env.port}/api/docs`);
});

// Interruptor de hombre muerto y check-in perdido (tarea 9): barrido periódico e idempotente.
// También corre al leer una sesión o la bandeja (en Render la instancia puede dormirse).
let sweeping = false;
if (env.triage.sweepIntervalS > 0) {
  const { runTriageSweep } = require('./services/emergency.service');
  setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    runTriageSweep()
      .catch((err) => console.error('[triage] barrido fallido:', err.message))
      .finally(() => {
        sweeping = false;
      });
  }, env.triage.sweepIntervalS * 1000).unref();
}

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} recibido, cerrando de forma ordenada...`);

  const forceExit = setTimeout(() => {
    console.error('[server] Cierre forzado tras 10 s');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  server.close(async (err) => {
    if (err) console.error('[server] Error al cerrar el servidor HTTP:', err.message);
    try {
      await pool.end();
      console.log('[server] Pool de base de datos cerrado');
      process.exit(err ? 1 : 0);
    } catch (poolErr) {
      console.error('[server] Error al cerrar el pool:', poolErr.message);
      process.exit(1);
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
