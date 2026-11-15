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
 *     - cualquier escalamiento (behavioral_health o flight_surgeon) → behavioral_health,
 *       is_confidential = true, a Tierra con deliver_at: el detalle es solo suyo. Nunca a la
 *       tripulación ni a admin;
 *     - si el catálogo lo escala a flight_surgeon (PVT_LAPSES critical), además una alerta
 *       NO confidencial al flight surgeon con solo el estado ("aptitud no confirmada"), sin
 *       valores ni métricas (category behavioral: admin no la ve, accessPolicy).
 *     - uno abierto por astronauta e indicador (regla de diseño, WELLBEING_ONE_OPEN_ESCALATION):
 *       mientras behavioral_health no cierre el que hay, un cambio que sigue sostenido no
 *       vuelve a escalar; la evaluación apunta al abierto.
 * Prioridad: critical = urgent, caution = routine (emergency la usa el triaje).
 * deliver_at NULL = corte de enlace sin fin conocido: queda en cola y se recalcula al cerrar
 * el corte (escalationDelivery.service.js).
 */
const env = require('../config/env');
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
    const targets = [
      {
        level: 'behavioral_health',
        category: 'behavioral',
        sourceType: 'wellbeing',
        isConfidential: true,
      },
    ];
    if (evaluation.escalation === 'flight_surgeon') {
      targets.push({
        level: 'flight_surgeon',
        category: 'behavioral',
        sourceType: 'wellbeing',
        isConfidential: false,
        statusOnly: true,
      });
    }
    return targets;
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
/**
 * Motivo del escalamiento. Lo confidencial nunca lleva el valor (solo behavioral_health abre
 * el detalle); la alerta de estado al flight surgeon tampoco nombra el indicador.
 */
function reasonFor(indicator, evaluation, components, target) {
  if (target.statusOnly) {
    return indicator.code.startsWith('PVT_')
      ? 'Aptitud no confirmada para tarea crítica (prueba de reacción). Sin métricas: el detalle es confidencial.'
      : 'Alerta de bienestar escalada al flight surgeon. El detalle es confidencial.';
  }
  if (indicator.sensitivity === 'confidential') {
    return `${indicator.code} en ${evaluation.level}: alerta de bienestar.`;
  }
  return `${indicator.code} en ${evaluation.level}: ${describe(indicator, components)}.`;
}

/**
 * Escalamiento conductual abierto (no cerrado) del astronauta para el indicador, o null.
 * Bloquea por astronauta + indicador hasta el fin de la transacción: dos check-ins a la vez
 * no abren dos.
 */
async function openBehavioral(reading, indicator, db) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `wb-escalation:${reading.astronaut_id}:${indicator.code}`,
  ]);
  return escalations.findOpenBehavioral(
    { astronautId: reading.astronaut_id, indicatorCode: indicator.code },
    db,
  );
}

async function escalateReading({ reading, indicator, evaluation }, db) {
  const targets = routeEvaluation(indicator, evaluation);
  if (!targets.length) return null;
  const priority = priorityFor(evaluation.level);

  let primaryId = null;
  for (const target of targets) {
    if (target.level === 'behavioral_health' && env.wellbeing.oneOpenEscalation) {
      const open = await openBehavioral(reading, indicator, db);
      if (open && open.source_id !== reading.id) {
        if (primaryId === null) primaryId = open.id;
        continue;
      }
    }
    const reason = reasonFor(indicator, evaluation, reading.components, target);
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
