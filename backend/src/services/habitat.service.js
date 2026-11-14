'use strict';

/**
 * Hábitat: lecturas de los sensores del módulo (POST /habitat/readings, rol service o
 * astronauta) y estado actual por módulo (GET /habitat/status).
 */
const { HttpError, badRequest, forbidden } = require('../utils/httpError');
const { isUuid } = require('../utils/validate');
const { LEVEL_ORDER } = require('../engine/conditions');
const { withTransaction } = require('../models/transaction');
const readings = require('../models/readings.model');
const catalog = require('./catalog.service');
const { toEvaluation, recordAndEvaluate } = require('./readingRecorder');
const { loadActor, enforceAccess } = require('./accessPolicy');
const { validateComponents, measuredAtIssue } = require('./readingValidation');

const HABITAT_CODES = ['HAB_CO2', 'HAB_TEMP', 'HAB_HUMIDITY', 'HAB_NOISE'];
const SOURCES = ['sensor', 'simulator', 'manual'];
const MAX_BATCH = 500;

const worst = (levels) =>
  levels.reduce((acc, l) => (LEVEL_ORDER[l] > LEVEL_ORDER[acc] ? l : acc), 'unrated');

async function missionActor(userId) {
  const actor = await loadActor(userId);
  if (!actor || !actor.mission_ids.length) {
    throw new HttpError(403, 'NO_ACTIVE_ASSIGNMENT', 'No tienes una misión vigente.');
  }
  return actor;
}

/** Problemas de un item del lote (sin client_uuid, que se valida antes). */
async function itemProblems(item, indicator) {
  const problems = [];
  if (!HABITAT_CODES.includes(item.indicator_code)) {
    problems.push({
      field: 'indicator_code',
      issue: `debe ser uno de: ${HABITAT_CODES.join(', ')}`,
    });
    return problems;
  }
  if (
    typeof item.module_id !== 'string' ||
    item.module_id.length < 1 ||
    item.module_id.length > 40
  ) {
    problems.push({ field: 'module_id', issue: 'es obligatorio (1 a 40 caracteres)' });
  }
  if (!SOURCES.includes(item.source)) {
    problems.push({ field: 'source', issue: `debe ser uno de: ${SOURCES.join(', ')}` });
  }
  const whenIssue = measuredAtIssue(item.measured_at);
  if (whenIssue) problems.push({ field: 'measured_at', issue: whenIssue });
  const components = { value: item.value, module_id: item.module_id };
  if (item.period !== undefined) components.period = item.period;
  problems.push(
    ...validateComponents(indicator, components, { fieldPrefix: 'reading' }).map((p) => ({
      ...p,
      field: p.field.replace('reading.', ''),
    })),
  );
  return problems;
}

async function processItem(item, { userId, missionId }) {
  const result = { client_uuid: item.client_uuid };
  const entry = HABITAT_CODES.includes(item.indicator_code)
    ? await catalog.indicatorWithRules(item.indicator_code)
    : null;
  const problems = await itemProblems(item, entry && entry.indicator);
  if (problems.length) {
    return {
      ...result,
      status: 'rejected',
      reading_id: null,
      escalation_id: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'La lectura tiene campos inválidos.',
        details: problems,
      },
    };
  }

  const existing = await readings.findByAuthor(userId, item.client_uuid);
  const asResult = (row, status) => ({
    ...result,
    status,
    reading_id: row.id,
    escalation_id: row.escalation_id || null,
    evaluation: toEvaluation(row.indicator_code, row),
  });
  if (existing) return asResult(existing, 'duplicate');

  const components = { value: item.value, module_id: item.module_id };
  if (item.period !== undefined) components.period = item.period;
  try {
    const row = await withTransaction((db) =>
      recordAndEvaluate(
        {
          clientUuid: item.client_uuid,
          recordedBy: userId,
          missionId,
          moduleId: item.module_id,
          indicatorCode: item.indicator_code,
          components,
          source: item.source,
          measuredAt: item.measured_at,
        },
        entry.indicator,
        db,
      ),
    );
    return asResult(row, 'accepted');
  } catch (err) {
    if (err.constraint === 'readings_author_uq') {
      return asResult(await readings.findByAuthor(userId, item.client_uuid), 'duplicate');
    }
    throw err;
  }
}

/** Lote de lecturas del hábitat. Resultado por item: accepted | duplicate | rejected. */
async function createHabitatReadings({ userId, body }) {
  const list = body && body.readings;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_BATCH) {
    throw badRequest([
      { field: 'readings', issue: `debe ser una lista de 1 a ${MAX_BATCH} lecturas` },
    ]);
  }
  const badIds = list
    .map((item, i) =>
      item && isUuid(item.client_uuid)
        ? null
        : { field: `readings[${i}].client_uuid`, issue: 'debe ser un UUID' },
    )
    .filter(Boolean);
  if (badIds.length) throw badRequest(badIds);

  const actor = await missionActor(userId);
  const missionId = actor.mission_ids[0];
  await enforceAccess(actor, {
    astronaut_id: null,
    mission_id: missionId,
    sensitivity: 'standard',
    category: 'physical',
    action: 'write',
  });

  const results = [];
  for (const item of list) results.push(await processItem(item, { userId, missionId }));
  return { results };
}

/** Estado de los módulos de la misión (último valor y nivel por indicador HAB_*). */
async function moduleStatuses({ missionId, moduleId }) {
  const rows = await readings.latestHabitat({ missionId, moduleId });
  const modules = new Map();
  for (const row of rows) {
    if (!modules.has(row.module_id)) modules.set(row.module_id, []);
    modules.get(row.module_id).push({
      code: row.indicator_code,
      level: row.level || 'unrated',
      value: row.components.value,
      avg_7d: row.derived && typeof row.derived.avg_7d === 'number' ? row.derived.avg_7d : null,
      measured_at: row.measured_at,
      escalation: row.escalation || 'self_care',
      recommendation: row.recommendation || '',
    });
  }
  return [...modules.entries()].map(([module, indicators]) => ({
    module_id: module,
    worst_level: worst(indicators.map((i) => i.level)),
    indicators: indicators.sort(
      (a, b) => HABITAT_CODES.indexOf(a.code) - HABITAT_CODES.indexOf(b.code),
    ),
  }));
}

async function habitatStatus({ userId, moduleId, missionId: requested }) {
  const actor = await missionActor(userId);
  if (requested !== undefined && !isUuid(requested)) {
    throw badRequest([{ field: 'mission_id', issue: 'debe ser un UUID' }]);
  }
  // Astronauta: su misión. Personal de Tierra: la pedida o la primera de su equipo.
  const missionId =
    actor.role === 'astronaut' ? actor.mission_ids[0] : requested || actor.mission_ids[0];
  if (actor.role === 'astronaut' && requested && requested !== missionId) {
    throw forbidden(null, 'Solo puedes ver el hábitat de tu misión.');
  }
  await enforceAccess(actor, {
    astronaut_id: null,
    mission_id: missionId,
    sensitivity: 'standard',
    category: 'physical',
    action: 'read',
  });
  return {
    mission_id: missionId,
    generated_at: new Date().toISOString(),
    modules: await moduleStatuses({ missionId, moduleId }),
  };
}

module.exports = { createHabitatReadings, habitatStatus, moduleStatuses };
