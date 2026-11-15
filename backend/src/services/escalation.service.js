'use strict';

/**
 * Escalamiento con retraso y enrutamiento por categoría (tarea 6).
 *
 * Enrutamiento de una evaluación (evaluateIndicator):
 *   physical (indicador estándar):
 *     - crew            → a bordo (oficial médico), delivered de inmediato;
 *     - flight_surgeon  → a Tierra, queued con deliver_at = compute_deliver_at(misión, now());
 *                         si el nivel es critical, también a bordo (Tierra llega con retraso).
 *   behavioral (indicador confidencial):
 *     - cualquier escalamiento (behavioral_health o flight_surgeon) → SOLO behavioral_health,
 *       is_confidential = true, a Tierra con deliver_at. Nunca a la tripulación ni a admin.
 * Prioridad: critical = urgent, caution = routine (emergency la usa el triaje).
 * deliver_at NULL = corte de enlace sin fin conocido: queda en cola y se recalcula al cerrar
 * el corte (escalationDelivery.service.js).
 */
const escalations = require('../models/escalations.model');

const PHYSICAL_LEVELS = ['crew', 'flight_surgeon'];
const BEHAVIORAL_LEVELS = ['behavioral_health', 'flight_surgeon'];

const priorityFor = (level) => (level === 'critical' ? 'urgent' : 'routine');

function describe(indicator, components) {
  if (indicator.code === 'BLOOD_PRESSURE') {
    return `${components.systolic}/${components.diastolic} ${indicator.unit}`;
  }
  if (typeof components.value === 'number') return `${components.value} ${indicator.unit}`;
  if (Array.isArray(components.symptoms)) return components.symptoms.join(', ') || 'sin síntomas';
  return JSON.stringify(components);
}

/**
 * Destinos de una evaluación: [{ level, category, sourceType, isConfidential }].
 * Pura: la usan escalateReading y las pruebas.
 */
function routeEvaluation(indicator, evaluation) {
  if (indicator.sensitivity === 'confidential') {
    if (!BEHAVIORAL_LEVELS.includes(evaluation.escalation)) return [];
    return [
      {
        level: 'behavioral_health',
        category: 'behavioral',
        sourceType: 'wellbeing',
        isConfidential: true,
      },
    ];
  }
  if (!PHYSICAL_LEVELS.includes(evaluation.escalation)) return [];
  const physical = { category: 'physical', sourceType: 'reading', isConfidential: false };
  const targets = [{ ...physical, level: evaluation.escalation }];
  if (evaluation.escalation === 'flight_surgeon' && evaluation.level === 'critical') {
    targets.push({ ...physical, level: 'crew' });
  }
  return targets;
}

/**
 * Crea los escalamientos de una lectura evaluada (dentro de la transacción `db`).
 * Idempotente por (lectura, destino). Devuelve el id del escalamiento principal o null.
 * Lo confidencial nunca dice el valor en `reason`: solo behavioral_health abre el detalle.
 */
async function escalateReading({ reading, indicator, evaluation }, db) {
  const targets = routeEvaluation(indicator, evaluation);
  if (!targets.length) return null;
  const priority = priorityFor(evaluation.level);
  const reason =
    indicator.sensitivity === 'confidential'
      ? `${indicator.code} en ${evaluation.level}: alerta de bienestar.`
      : `${indicator.code} en ${evaluation.level}: ${describe(indicator, reading.components)}.`;

  let primaryId = null;
  for (const target of targets) {
    const { row } = await escalations.insert(
      {
        missionId: reading.mission_id,
        astronautId: reading.astronaut_id,
        sourceType: target.sourceType,
        sourceId: reading.id,
        level: target.level,
        priority,
        reason,
        category: target.category,
        isConfidential: target.isConfidential,
      },
      db,
    );
    if (primaryId === null) primaryId = row.id;
  }
  return primaryId;
}

module.exports = { routeEvaluation, escalateReading, priorityFor };
