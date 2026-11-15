'use strict';

/**
 * Registro de bienestar (CONFIDENCIAL): check-in diario, corrida PVT y cuestionario, cada uno
 * con sus lecturas agrupadas (wellbeing_checkin_id, pvt_run_id, instrument_administration_id).
 *
 * Cada lectura pasa por el mismo camino que POST /readings (recordAndEvaluate): reglas
 * activas + derivados + escalamiento. Lo confidencial escala SOLO a behavioral_health
 * (escalation.service.js). Lo usa el simulador; los endpoints /wellbeing/* (tarea 10) deben
 * usarlo también. Devuelve el detalle de la evaluación: quien lo exponga decide qué mostrar
 * (al astronauta, un mensaje neutro; a admin, nada).
 */
const { HttpError, badRequest, conflict } = require('../utils/httpError');
const { fitnessFromPvt } = require('../engine/conditions');
const { withTransaction } = require('../models/transaction');
const readings = require('../models/readings.model');
const wellbeing = require('../models/wellbeing.model');
const catalog = require('./catalog.service');
const { recordAndEvaluate } = require('./readingRecorder');
const { loadActor, enforceAccess } = require('./accessPolicy');
const { validateComponents, measuredAtIssue } = require('./readingValidation');

async function astronautActor(userId) {
  const actor = await loadActor(userId);
  if (!actor || actor.role !== 'astronaut' || !actor.astronaut_id || !actor.mission_ids.length) {
    throw new HttpError(403, 'NO_ACTIVE_ASSIGNMENT', 'No tienes una asignación de misión vigente.');
  }
  return actor;
}

/** Valida una lectura del grupo y devuelve su indicador. */
async function checkReading({ code, components, inputMethod, measuredAt }) {
  const entry = await catalog.indicatorWithRules(code);
  if (!entry) throw badRequest([{ field: 'indicator_code', issue: `${code} no existe` }]);
  const { indicator } = entry;
  const problems = validateComponents(indicator, components, { fieldPrefix: code });
  if (!indicator.input_methods.includes(inputMethod)) {
    problems.push({ field: `${code}.input_method`, issue: `no admite ${inputMethod}` });
  }
  const whenIssue = measuredAtIssue(measuredAt);
  if (whenIssue) problems.push({ field: 'measured_at', issue: whenIssue });
  if (problems.length) throw badRequest(problems);
  return indicator;
}

async function enforceOwnWrite(actor) {
  await enforceAccess(actor, {
    astronaut_id: actor.astronaut_id,
    mission_id: actor.mission_ids[0],
    sensitivity: 'confidential',
    category: 'behavioral',
    action: 'write',
  });
}

/**
 * Crea el grupo y sus lecturas en una transacción. Si el grupo ya existía (mismo
 * client_uuid), no toca nada y responde duplicate.
 */
async function recordGroup(actor, { insertGroup, entries, afterReadings }) {
  const checked = [];
  for (const entry of entries) checked.push({ ...entry, indicator: await checkReading(entry) });
  return withTransaction(async (db) => {
    const group = await insertGroup(db);
    if (!group.created) {
      return {
        status: 'duplicate',
        group_id: group.id,
        readings: [],
        reading_count: checked.length,
      };
    }
    const out = [];
    for (const entry of checked) {
      const row = await recordAndEvaluate(
        {
          clientUuid: entry.clientUuid,
          recordedBy: actor.user_id,
          missionId: actor.mission_ids[0],
          astronautId: actor.astronaut_id,
          indicatorCode: entry.code,
          components: entry.components,
          source: entry.inputMethod,
          deviceId: entry.deviceId,
          measuredAt: entry.measuredAt,
          supersedesUuid: entry.supersedesUuid,
          [entry.groupColumn]: group.id,
        },
        entry.indicator,
        db,
      );
      out.push({
        indicator_code: entry.code,
        sensitivity: entry.indicator.sensitivity,
        reading_id: row.id,
        level: row.level,
        escalation_id: row.escalation_id,
      });
    }
    if (afterReadings) await afterReadings(group.id, out, db);
    return { status: 'accepted', group_id: group.id, readings: out };
  });
}

/**
 * Check-in diario: { client_uuid, measured_at, sleep_hours?, sleep_uuid?, sliders } con
 * sliders = { WB_MOOD: { value, client_uuid }, ... }. SLEEP_HOURS (estándar) va en el grupo.
 */
async function recordCheckin({ userId, checkin }) {
  const actor = await astronautActor(userId);
  await enforceOwnWrite(actor);
  const entries = Object.entries(checkin.sliders).map(([code, { value, client_uuid }]) => ({
    code,
    clientUuid: client_uuid,
    components: { value },
    inputMethod: 'slider',
    measuredAt: checkin.measured_at,
    groupColumn: 'wellbeingCheckinId',
  }));
  if (checkin.sleep_hours != null && checkin.sleep_uuid) {
    entries.unshift({
      code: 'SLEEP_HOURS',
      clientUuid: checkin.sleep_uuid,
      components: { value: checkin.sleep_hours },
      inputMethod: 'wearable',
      measuredAt: checkin.measured_at,
      groupColumn: 'wellbeingCheckinId',
    });
  }
  return recordGroup(actor, {
    entries,
    insertGroup: (db) =>
      wellbeing.insertCheckin(
        {
          clientUuid: checkin.client_uuid,
          astronautId: actor.astronaut_id,
          measuredAt: checkin.measured_at,
          sleepHours: checkin.sleep_hours,
        },
        db,
      ),
  });
}

/**
 * Corrige deslizadores de un check-in existente: lecturas nuevas con supersedes_uuid, en el
 * mismo check-in y con su measured_at. corrections = [{ client_uuid, supersedes_uuid,
 * indicator_code, value, measured_at }]. Idempotente por client_uuid de cada corrección.
 */
async function correctCheckin({ userId, checkinId, corrections }) {
  const actor = await astronautActor(userId);
  await enforceOwnWrite(actor);
  const out = [];
  for (const c of corrections) {
    const existing = await readings.findByAuthor(userId, c.client_uuid);
    if (existing) {
      out.push({ indicator_code: c.indicator_code, status: 'duplicate', reading_id: existing.id });
      continue;
    }
    const target = await readings.findSupersedeTarget(userId, c.supersedes_uuid);
    if (!target || target.superseded || target.indicator_code !== c.indicator_code) {
      throw conflict('CONFLICT', 'La lectura que intentas corregir no existe o ya fue corregida.', {
        supersedes_uuid: c.supersedes_uuid,
      });
    }
    const components = { value: c.value };
    const indicator = await checkReading({
      code: c.indicator_code,
      components,
      inputMethod: 'slider',
      measuredAt: c.measured_at,
    });
    const row = await withTransaction((db) =>
      recordAndEvaluate(
        {
          clientUuid: c.client_uuid,
          recordedBy: userId,
          missionId: actor.mission_ids[0],
          astronautId: actor.astronaut_id,
          indicatorCode: c.indicator_code,
          components,
          source: 'slider',
          measuredAt: c.measured_at,
          supersedesUuid: c.supersedes_uuid,
          wellbeingCheckinId: checkinId,
        },
        indicator,
        db,
      ),
    );
    out.push({
      indicator_code: c.indicator_code,
      status: 'accepted',
      sensitivity: indicator.sensitivity,
      reading_id: row.id,
      level: row.level,
      escalation_id: row.escalation_id,
    });
  }
  return { readings: out };
}

/**
 * Corrida PVT: { client_uuid, device_id, measured_at, before_critical_task, duration_s,
 * trials, readings: [{ indicator_code, value, client_uuid }] }. La aptitud (fitnessFromPvt)
 * queda en pvt_runs.fitness: es lo único que ven admin y el flight surgeon.
 */
async function recordPvtRun({ userId, run }) {
  const actor = await astronautActor(userId);
  await enforceOwnWrite(actor);
  const result = await recordGroup(actor, {
    entries: run.readings.map((r) => ({
      code: r.indicator_code,
      clientUuid: r.client_uuid,
      components: { value: r.value, device_id: run.device_id },
      inputMethod: 'minigame',
      deviceId: run.device_id,
      measuredAt: run.measured_at,
      groupColumn: 'pvtRunId',
    })),
    insertGroup: (db) =>
      wellbeing.insertPvtRun(
        {
          clientUuid: run.client_uuid,
          astronautId: actor.astronaut_id,
          deviceId: run.device_id,
          beforeCriticalTask: run.before_critical_task,
          durationS: run.duration_s,
          trials: run.trials,
          measuredAt: run.measured_at,
        },
        db,
      ),
    afterReadings: (id, rows, db) => wellbeing.setPvtFitness(id, fitnessFromPvt(rows), db),
  });
  if (result.status === 'accepted') result.fitness = fitnessFromPvt(result.readings);
  return result;
}

/**
 * Cuestionario: { client_uuid, instrument (PHQ2 | GAD2), answers: { item_1, item_2 },
 * measured_at, reading_uuid }. Puntaje = suma de los ítems (scoring del seed).
 */
async function recordInstrument({ userId, administration }) {
  const actor = await astronautActor(userId);
  await enforceOwnWrite(actor);
  const instrument = await wellbeing.activeInstrument(administration.instrument);
  if (!instrument) {
    throw badRequest([{ field: 'instrument', issue: `${administration.instrument} no existe` }]);
  }
  const score = Object.values(administration.answers).reduce((s, v) => s + v, 0);
  return recordGroup(actor, {
    entries: [
      {
        code: instrument.indicator_code,
        clientUuid: administration.reading_uuid,
        components: { value: score, ...administration.answers },
        inputMethod: 'questionnaire',
        measuredAt: administration.measured_at,
        groupColumn: 'instrumentAdministrationId',
      },
    ],
    insertGroup: (db) =>
      wellbeing.insertAdministration(
        {
          clientUuid: administration.client_uuid,
          astronautId: actor.astronaut_id,
          instrumentId: instrument.id,
          answers: administration.answers,
          score,
          measuredAt: administration.measured_at,
        },
        db,
      ),
  });
}

module.exports = { recordCheckin, correctCheckin, recordPvtRun, recordInstrument };
