'use strict';

/**
 * Lecturas del astronauta: registro con evaluación (POST /readings), series para gráficas
 * (GET /me/readings) y semáforo por zona del cuerpo (GET /me/body-status).
 * Todo pasa por accessPolicy; las lecturas que se muestran salen de v_readings_standard.
 */
const { HttpError, badRequest, conflict } = require('../utils/httpError');
const { isUuid } = require('../utils/validate');
const { LEVEL_ORDER } = require('../engine/conditions');
const { withTransaction } = require('../models/transaction');
const readings = require('../models/readings.model');
const catalog = require('./catalog.service');
const { toEvaluation, recordAndEvaluate } = require('./readingRecorder');
const { loadActor, enforceAccess } = require('./accessPolicy');
const { validateComponents, measuredAtIssue } = require('./readingValidation');
const habitat = require('./habitat.service');

const noAssignment = () =>
  new HttpError(403, 'NO_ACTIVE_ASSIGNMENT', 'No tienes una asignación de misión vigente.');

// ---------------------------------------------------------------- formas del contrato

const toReading = (row) => ({
  id: row.id,
  client_uuid: row.client_uuid,
  supersedes_uuid: row.supersedes_uuid,
  astronaut_id: row.astronaut_id,
  indicator_code: row.indicator_code,
  values: row.components,
  input_method: row.source,
  device_id: row.device_id,
  attachment_id: row.attachment_id,
  measured_at: row.measured_at,
  received_at: row.received_at,
  superseded_by: row.superseded_by,
  synthetic: row.synthetic,
});

const toCreated = (row) => ({
  reading: toReading(row),
  evaluation: toEvaluation(row.indicator_code, row),
  escalation_id: row.escalation_id || null,
});

// ---------------------------------------------------------------- registro + evaluación

async function astronautActor(userId) {
  const actor = await loadActor(userId);
  if (!actor || actor.role !== 'astronaut' || !actor.astronaut_id || !actor.mission_ids.length) {
    throw noAssignment();
  }
  return actor;
}

async function createReading({ userId, input }) {
  const actor = await astronautActor(userId);
  const missionId = actor.mission_ids[0];

  const entry = await catalog.indicatorWithRules(input.indicator_code);
  if (!entry) throw badRequest([{ field: 'indicator_code', issue: 'no existe en el catálogo' }]);
  const { indicator } = entry;
  if (indicator.sensitivity === 'confidential') {
    throw badRequest(
      [{ field: 'indicator_code', issue: 'es confidencial: se registra solo por /wellbeing/*' }],
      `${indicator.code} es un indicador de bienestar (confidencial).`,
    );
  }
  if (indicator.body_zone === 'environment') {
    throw badRequest([
      { field: 'indicator_code', issue: 'es del hábitat: usa POST /habitat/readings' },
    ]);
  }

  const problems = validateComponents(indicator, input.values, {
    symptomCodes: await catalog.symptomZones(),
  });
  if (!indicator.input_methods.includes(input.input_method)) {
    problems.push({
      field: 'input_method',
      issue: `para ${indicator.code} debe ser uno de: ${indicator.input_methods.join(', ')}`,
    });
  }
  const whenIssue = measuredAtIssue(input.measured_at);
  if (whenIssue) problems.push({ field: 'measured_at', issue: whenIssue });
  if (input.attachment_id && !(await readings.attachmentOwnedBy(input.attachment_id, userId))) {
    problems.push({ field: 'attachment_id', issue: 'no existe o no es tuyo' });
  }
  if (problems.length) throw badRequest(problems);

  await enforceAccess(actor, {
    astronaut_id: actor.astronaut_id,
    mission_id: missionId,
    sensitivity: indicator.sensitivity,
    category: 'physical',
    action: 'write',
  });

  // Idempotencia: mismo client_uuid del mismo autor → 200 con lo existente.
  const existing = await readings.findByAuthor(userId, input.client_uuid);
  if (existing) return { status: 200, body: toCreated(existing) };

  if (input.supersedes_uuid) {
    const target = await readings.findSupersedeTarget(userId, input.supersedes_uuid);
    if (!target) {
      throw conflict('CONFLICT', 'La lectura que intentas corregir no existe.', {
        supersedes_uuid: input.supersedes_uuid,
      });
    }
    if (target.superseded) {
      throw conflict('CONFLICT', 'La lectura que intentas corregir ya fue reemplazada.', {
        supersedes_uuid: input.supersedes_uuid,
      });
    }
    if (target.indicator_code !== indicator.code) {
      throw badRequest([
        { field: 'supersedes_uuid', issue: `corresponde a ${target.indicator_code}` },
      ]);
    }
  }

  try {
    const row = await withTransaction((db) =>
      recordAndEvaluate(
        {
          clientUuid: input.client_uuid,
          recordedBy: userId,
          missionId,
          astronautId: actor.astronaut_id,
          indicatorCode: indicator.code,
          components: input.values,
          source: input.input_method,
          deviceId: input.device_id,
          attachmentId: input.attachment_id,
          note: input.note,
          supersedesUuid: input.supersedes_uuid,
          measuredAt: input.measured_at,
        },
        indicator,
        db,
      ),
    );
    return { status: 201, body: toCreated(row) };
  } catch (err) {
    if (err.constraint === 'readings_author_uq') {
      return {
        status: 200,
        body: toCreated(await readings.findByAuthor(userId, input.client_uuid)),
      };
    }
    if (err.constraint === 'readings_supersedes_once_uq') {
      throw conflict('CONFLICT', 'La lectura que intentas corregir ya fue reemplazada.', {
        supersedes_uuid: input.supersedes_uuid,
      });
    }
    throw err;
  }
}

// ---------------------------------------------------------------- series (/me/readings)

const encodeCursor = (row) =>
  Buffer.from(JSON.stringify({ m: new Date(row.measured_at).toISOString(), id: row.id })).toString(
    'base64url',
  );

function decodeCursor(cursor) {
  try {
    const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!value || Number.isNaN(Date.parse(value.m)) || !isUuid(value.id)) throw new Error('cursor');
    return value;
  } catch {
    throw badRequest([{ field: 'cursor', issue: 'cursor inválido' }]);
  }
}

async function listMyReadings({ userId, query }) {
  const actor = await astronautActor(userId);
  const problems = [];
  if (query.code !== undefined) {
    const entry = await catalog.indicatorWithRules(query.code);
    if (!entry) problems.push({ field: 'code', issue: 'no existe en el catálogo' });
    else if (entry.indicator.sensitivity === 'confidential') {
      problems.push({ field: 'code', issue: 'es confidencial: usa GET /me/wellbeing' });
    }
  }
  for (const name of ['from', 'to']) {
    if (query[name] !== undefined && Number.isNaN(Date.parse(query[name]))) {
      problems.push({ field: name, issue: 'debe ser una fecha ISO 8601 en UTC' });
    }
  }
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    problems.push({ field: 'limit', issue: 'debe ser un entero entre 1 y 200' });
  }
  if (problems.length) throw badRequest(problems);
  const after = query.cursor !== undefined ? decodeCursor(query.cursor) : null;

  await enforceAccess(actor, {
    astronaut_id: actor.astronaut_id,
    mission_id: actor.mission_ids[0],
    sensitivity: 'standard',
    category: 'physical',
    action: 'read',
  });

  const rows = await readings.series({
    astronautId: actor.astronaut_id,
    code: query.code,
    from: query.from,
    to: query.to,
    after,
    limit,
  });
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => ({
      id: r.id,
      indicator_code: r.indicator_code,
      values: r.components,
      level: r.level || 'unrated',
      measured_at: r.measured_at,
      received_at: r.received_at,
    })),
    next_cursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
  };
}

// ---------------------------------------------------------------- body-status

const worst = (levels) =>
  levels.reduce((acc, l) => (LEVEL_ORDER[l] > LEVEL_ORDER[acc] ? l : acc), 'unrated');

function indicatorStatus(indicator, row) {
  const status = {
    code: indicator.code,
    name: indicator.name,
    level: row ? row.level || 'unrated' : 'unrated',
    escalation: row ? row.escalation || 'self_care' : 'self_care',
    recommendation: row ? (row.recommendation ?? null) : null,
  };
  if (row)
    status.last_value = {
      reading_id: row.id,
      values: row.components,
      measured_at: row.measured_at,
    };
  return status;
}

/**
 * Por zona: peor nivel e indicadores estándar con su último valor. Los confidenciales no
 * aportan color: en brain solo cuenta SLEEP_HOURS y del bienestar se informa
 * checkin_completed (sí/no). SYMPTOM aparece en la zona de cada síntoma reportado.
 * La tarjeta environment es el módulo pedido o el de la lectura del hábitat más reciente.
 */
async function bodyStatus({ userId, moduleId }) {
  const actor = await astronautActor(userId);
  const missionId = actor.mission_ids[0];
  await enforceAccess(actor, {
    astronaut_id: actor.astronaut_id,
    mission_id: missionId,
    sensitivity: 'standard',
    category: 'physical',
    action: 'read',
  });

  const [zones, indicators, symptomZones, latest, rulesVersion, checkinDone] = await Promise.all([
    catalog.zoneList(),
    catalog.standardIndicators(),
    catalog.symptomZones(),
    readings.latestForAstronaut(actor.astronaut_id),
    catalog.rulesVersion(),
    readings.checkinCompletedToday(actor.astronaut_id),
  ]);
  const latestByCode = new Map(latest.map((r) => [r.indicator_code, r]));
  const body = zones.filter((z) => z.code !== 'environment' && z.code !== 'by_symptom');
  const byZone = new Map(body.map((z) => [z.code, { zone: z.code, name: z.name, indicators: [] }]));

  for (const indicator of indicators) {
    if (byZone.has(indicator.body_zone)) {
      byZone
        .get(indicator.body_zone)
        .indicators.push(indicatorStatus(indicator, latestByCode.get(indicator.code)));
    }
  }
  const symptomIndicator = indicators.find((i) => i.code === 'SYMPTOM');
  const symptomRow = latestByCode.get('SYMPTOM');
  if (symptomIndicator && symptomRow && Array.isArray(symptomRow.components.symptoms)) {
    const hit = new Set(symptomRow.components.symptoms.map((s) => symptomZones.get(s)));
    for (const zone of hit) {
      if (byZone.has(zone))
        byZone.get(zone).indicators.push(indicatorStatus(symptomIndicator, symptomRow));
    }
  }

  const out = {
    astronaut_id: actor.astronaut_id,
    generated_at: new Date().toISOString(),
    rules_version: rulesVersion,
    zones: [...byZone.values()].map((z) => {
      const zone = {
        zone: z.zone,
        name: z.name,
        worst_level: worst(z.indicators.map((i) => i.level)),
        indicators: z.indicators,
      };
      if (z.zone === 'brain') zone.checkin_completed = checkinDone;
      return zone;
    }),
  };

  const module = moduleId || (await readings.latestModule(missionId));
  if (module) {
    const status = await habitat.moduleStatuses({ missionId, moduleId: module });
    if (status.length) out.environment = status[0];
  }
  return out;
}

module.exports = { createReading, listMyReadings, bodyStatus };
