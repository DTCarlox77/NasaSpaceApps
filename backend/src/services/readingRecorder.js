'use strict';

/**
 * Registro y evaluación de una lectura, compartido por POST /readings (astronauta) y
 * POST /habitat/readings (sensores). Todo dentro de la transacción `db`.
 */
const readings = require('../models/readings.model');
const evaluationService = require('./evaluation.service');
const { escalateReading } = require('./escalation.service');

/** IndicatorEvaluation (forma de evaluateIndicator) desde una fila, sin campos nulos. */
function toEvaluation(code, row) {
  const out = { code, level: row.level || 'unrated', rule_index: row.rule_index ?? -1 };
  if (row.rules_version != null) out.rules_version = row.rules_version;
  if (row.recommendation != null) out.recommendation = row.recommendation;
  out.escalation = row.escalation || 'self_care';
  if (row.basis != null) out.basis = row.basis;
  if (row.source_ids) out.source_ids = row.source_ids;
  return out;
}

/**
 * Guarda la lectura, la evalúa (reglas activas + derivados), escala si corresponde y guarda
 * la evaluación con su rules_version. Devuelve la fila con la evaluación y escalation_id.
 */
async function recordAndEvaluate(row, indicator, db) {
  const reading = await readings.insert(row, db);
  const { evaluation, derived } = await evaluationService.evaluateReading(reading, db);
  const escalationId = await escalateReading({ reading, indicator, evaluation }, db);
  await readings.saveEvaluation(
    { readingId: reading.id, indicatorCode: indicator.code, evaluation, derived, escalationId },
    db,
  );
  return { ...reading, ...evaluation, derived, escalation_id: escalationId };
}

module.exports = { toEvaluation, recordAndEvaluate };
