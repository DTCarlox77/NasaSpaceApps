'use strict';

/**
 * Escalamiento MÍNIMO a partir de una lectura evaluada.
 *
 * TODO(tarea 6): servicio completo de escalamiento:
 *   - enrutamiento por categoría (physical | behavioral | emergency) y prioridad configurable;
 *   - transición queued → delivered cuando pasa deliver_at, y reintento al cerrar un corte
 *     (deliver_at NULL = en cola esperando enlace);
 *   - bandeja de Tierra, acuse (ack) y mensajes con retraso; notificaciones a bordo.
 * Hoy solo crea las filas en `escalations` para que la bandeja de la tarea 6 las encuentre.
 */
const escalations = require('../models/escalations.model');

const LEVELS_ESCALATED = ['crew', 'flight_surgeon'];

function describe(indicator, components) {
  if (indicator.code === 'BLOOD_PRESSURE') {
    return `${components.systolic}/${components.diastolic} ${indicator.unit}`;
  }
  if (typeof components.value === 'number') return `${components.value} ${indicator.unit}`;
  if (Array.isArray(components.symptoms)) return components.symptoms.join(', ') || 'sin síntomas';
  return JSON.stringify(components);
}

/**
 * Si la evaluación escala a crew o flight_surgeon, crea el escalamiento (y, si el nivel
 * es critical y va a Tierra, avisa también a la tripulación a bordo, porque Tierra llega
 * con retraso). Devuelve el id del escalamiento principal o null.
 */
async function escalateReading({ reading, indicator, evaluation }, db) {
  if (!LEVELS_ESCALATED.includes(evaluation.escalation)) return null;
  const priority = evaluation.level === 'critical' ? 'urgent' : 'routine';
  const reason = `${indicator.code} en ${evaluation.level}: ${describe(indicator, reading.components)}.`;
  const base = {
    missionId: reading.mission_id,
    astronautId: reading.astronaut_id,
    readingId: reading.id,
    priority,
    reason,
  };
  const primary = await escalations.insertForReading({ ...base, level: evaluation.escalation }, db);
  if (evaluation.escalation === 'flight_surgeon' && evaluation.level === 'critical') {
    await escalations.insertForReading({ ...base, level: 'crew' }, db);
  }
  return primary.id;
}

module.exports = { escalateReading };
