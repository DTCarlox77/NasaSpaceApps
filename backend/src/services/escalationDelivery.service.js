'use strict';

/**
 * Entrega con retraso: lo que cruza el enlace con Tierra lleva deliver_at.
 * - queued → delivered: al leer la bandeja (promoteDelivered). No hace falta un job:
 *   la bandeja y el hilo filtran por deliver_at <= now(), y el estado se pone al día al leer.
 * - Cortes de enlace: al crear, corregir o cerrar un corte se recalcula deliver_at de lo que
 *   todavía no llegó (NULL = en cola, o una hora futura) con compute_deliver_at(misión, envío).
 *   La base no lo hace sola (ver RELEVO.md); por eso todo cambio de cortes pasa por aquí.
 */
const escalations = require('../models/escalations.model');

async function promoteDelivered(missionId, db) {
  return escalations.promoteDelivered(missionId, db);
}

/** Recalcula lo pendiente de la misión tras un cambio de cortes (dentro de `db`). */
async function recomputeAfterOutageChange(missionId, db) {
  return escalations.recomputePending(missionId, db);
}

module.exports = { promoteDelivered, recomputeAfterOutageChange };
