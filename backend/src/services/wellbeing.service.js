'use strict';

/**
 * Bienestar del lado del astronauta (tarea 10): check-in diario, cuestionarios (PHQ-2 y
 * GAD-2), prueba de reacción (PVT), instrumentos y su propio historial.
 *
 * Las rutas en línea (/wellbeing/*) y /sync/push (wellbeing_checkin, wellbeing_screening,
 * pvt_run) usan estas mismas funciones: mismo body, misma validación, misma idempotencia
 * (client_uuid) y la misma respuesta.
 *
 * NO DIAGNOSTICA: al astronauta solo le llega el mensaje neutro de la regla del catálogo
 * (recommendation), nunca un nivel, un color, un puntaje ni un escalamiento. La racha cuenta
 * check-ins completados, nunca el resultado.
 */
const env = require('../config/env');
const { HttpError, badRequest, forbidden } = require('../utils/httpError');
const { isUuid } = require('../utils/validate');
const { derivedUuid } = require('../utils/derivedUuid');
const { decodeCursor, limitIssue, parseLimit, toPage } = require('../utils/pagination');
const { ESCALATION_ORDER } = require('../engine/conditions');
const wellbeing = require('../models/wellbeing.model');
const recorder = require('./wellbeingRecorder');
const { loadActor, canAccess } = require('./accessPolicy');
const { measuredAtIssue } = require('./readingValidation');

const DAY_MS = 24 * 60 * 60 * 1000;

const CHECKIN_SLIDERS = {
  mood: 'WB_MOOD',
  fatigue: 'WB_FATIGUE',
  stress: 'WB_STRESS',
  crew_conflict: 'WB_CREW_CONFLICT',
};
const SLIDER_FIELDS = Object.fromEntries(Object.entries(CHECKIN_SLIDERS).map(([f, c]) => [c, f]));
const PVT_METRICS = {
  lapses: 'PVT_LAPSES',
  mean_rt_ms: 'PVT_MEAN_RT',
  false_starts: 'PVT_FALSE_STARTS',
};
const INSTRUMENTS = ['PHQ2', 'GAD2'];

const MESSAGES = {
  checkin: 'Gracias por tu check-in.',
  screening: 'Gracias por responder.',
  pvtFit: 'Tu atención está en tu rango habitual.',
  pvtNotConfirmed:
    'Tu resultado no confirma la aptitud para la tarea. Descansa y repite la prueba más tarde.',
};

/**
 * client_uuid de cada lectura del grupo, derivado del client_uuid del registro: un reintento
 * (en línea o por sync) da los mismos y no duplica. Mismo espacio de nombres que la tarea 8.
 */
const groupUuid = (clientUuid, code) => derivedUuid('sync-group', clientUuid, code);

// ---------------------------------------------------------------- funciones puras

const LEVEL_RANK = { critical: 3, caution: 2, unrated: 1, normal: 0 };

/**
 * Mensaje neutro de un grupo: la recommendation de la regla más relevante (la que escala más
 * lejos y luego la de mayor nivel; "aprendiendo tu rango" antes que "gracias"). Es el texto
 * del catálogo, que nunca lleva un puntaje ni un color.
 */
function neutralMessage(evaluations, fallback) {
  const rank = (e) => (ESCALATION_ORDER[e.escalation] ?? 0) * 10 + (LEVEL_RANK[e.level] ?? 0);
  const best = (evaluations || [])
    .filter((e) => typeof e.recommendation === 'string' && e.recommendation)
    .sort((a, b) => rank(b) - rank(a))[0];
  return best ? best.recommendation : fallback;
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Racha (cuenta check-ins completados, nunca el resultado): días UTC seguidos con check-in
 * que terminan hoy, o ayer si hoy todavía no lo hizo. checkins_this_week = días con check-in
 * en los últimos 7 días UTC (hoy incluido); meta 7.
 */
function streakFrom(days, nowMs = Date.now()) {
  const set = new Set(days);
  const today = Math.floor(nowMs / DAY_MS);
  let day = set.has(isoDay(today * DAY_MS)) ? today : today - 1;
  let streak = 0;
  while (set.has(isoDay(day * DAY_MS))) {
    streak += 1;
    day -= 1;
  }
  let week = 0;
  for (let d = today - 6; d <= today; d += 1) if (set.has(isoDay(d * DAY_MS))) week += 1;
  return { streak_days: streak, checkins_this_week: week, checkins_goal_week: 7 };
}

/**
 * PHQ-2 y GAD-2 cada `everyDays` días, un día antes de la conferencia psicológica (regla de
 * diseño, WELLBEING_SCREENING_EVERY_DAYS): toca si alguno nunca se hizo o el último fue hace
 * everyDays − 1 días o más.
 */
function screeningDue(
  lastByCode,
  nowMs = Date.now(),
  everyDays = env.wellbeing.screeningEveryDays,
) {
  return INSTRUMENTS.some((code) => {
    const last = lastByCode.get(code);
    return !last || nowMs - new Date(last).getTime() >= (everyDays - 1) * DAY_MS;
  });
}

// ---------------------------------------------------------------- validación

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

function requireClientUuid(problems, value, field) {
  if (!isUuid(value)) problems.push({ field, issue: 'debe ser un UUID' });
}

function checkMeasuredAt(problems, value, field) {
  const issue = measuredAtIssue(value);
  if (issue) problems.push({ field, issue });
}

/**
 * Body del check-in (CheckinCreate). prefix = '' en línea, 'payload.' por sync (ahí el
 * client_uuid va en el item). sleep_hours es opcional (viene de la pulsera).
 */
function validateCheckin(body, { prefix = '', clientUuid } = {}) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const problems = [];
  if (clientUuid === undefined) requireClientUuid(problems, b.client_uuid, 'client_uuid');
  checkMeasuredAt(problems, b.measured_at, `${prefix}measured_at`);
  for (const field of Object.keys(CHECKIN_SLIDERS)) {
    if (!isInt(b[field], 0, 100)) {
      problems.push({ field: `${prefix}${field}`, issue: 'debe ser un entero entre 0 y 100' });
    }
  }
  if (
    b.sleep_hours != null &&
    !(isNumber(b.sleep_hours) && b.sleep_hours >= 0 && b.sleep_hours <= 24)
  ) {
    problems.push({ field: `${prefix}sleep_hours`, issue: 'debe estar entre 0 y 24' });
  }
  if (
    b.private_note != null &&
    (typeof b.private_note !== 'string' || b.private_note.length > 1000)
  ) {
    problems.push({
      field: `${prefix}private_note`,
      issue: 'debe ser texto de hasta 1000 caracteres',
    });
  }
  if (problems.length) throw badRequest(problems);
  return {
    client_uuid: clientUuid ?? b.client_uuid,
    measured_at: b.measured_at,
    sliders: Object.fromEntries(Object.entries(CHECKIN_SLIDERS).map(([f, c]) => [c, b[f]])),
    sleep_hours: b.sleep_hours ?? null,
    private_note: b.private_note ?? null,
  };
}

function validateScreening(body, { prefix = '', clientUuid } = {}) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const problems = [];
  if (clientUuid === undefined) requireClientUuid(problems, b.client_uuid, 'client_uuid');
  if (!INSTRUMENTS.includes(b.instrument)) {
    problems.push({
      field: `${prefix}instrument`,
      issue: `debe ser uno de: ${INSTRUMENTS.join(', ')}`,
    });
  }
  checkMeasuredAt(problems, b.measured_at, `${prefix}measured_at`);
  for (const field of ['item_1', 'item_2']) {
    if (!isInt(b[field], 0, 3)) {
      problems.push({ field: `${prefix}${field}`, issue: 'debe ser un entero entre 0 y 3' });
    }
  }
  if (problems.length) throw badRequest(problems);
  return {
    client_uuid: clientUuid ?? b.client_uuid,
    instrument: b.instrument,
    measured_at: b.measured_at,
    answers: { item_1: b.item_1, item_2: b.item_2 },
  };
}

function validatePvt(body, { prefix = '', clientUuid } = {}) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const problems = [];
  if (clientUuid === undefined) requireClientUuid(problems, b.client_uuid, 'client_uuid');
  if (typeof b.device_id !== 'string' || !b.device_id.trim() || b.device_id.length > 100) {
    problems.push({ field: `${prefix}device_id`, issue: 'es obligatorio (hasta 100 caracteres)' });
  }
  checkMeasuredAt(problems, b.measured_at, `${prefix}measured_at`);
  if (typeof b.before_critical_task !== 'boolean') {
    problems.push({ field: `${prefix}before_critical_task`, issue: 'debe ser true o false' });
  }
  for (const field of ['duration_s', 'trials']) {
    if (b[field] != null && !isInt(b[field], 1, 100000)) {
      problems.push({ field: `${prefix}${field}`, issue: 'debe ser un entero mayor que 0' });
    }
  }
  for (const field of ['lapses', 'false_starts']) {
    if (!isInt(b[field], 0, 100000)) {
      problems.push({
        field: `${prefix}${field}`,
        issue: 'debe ser un entero mayor o igual que 0',
      });
    }
  }
  if (!(isNumber(b.mean_rt_ms) && b.mean_rt_ms >= 0)) {
    problems.push({
      field: `${prefix}mean_rt_ms`,
      issue: 'debe ser un número mayor o igual que 0',
    });
  }
  if (problems.length) throw badRequest(problems);
  return {
    client_uuid: clientUuid ?? b.client_uuid,
    device_id: b.device_id,
    measured_at: b.measured_at,
    before_critical_task: b.before_critical_task,
    duration_s: b.duration_s ?? null,
    trials: b.trials ?? null,
    metrics: { lapses: b.lapses, mean_rt_ms: b.mean_rt_ms, false_starts: b.false_starts },
  };
}

// ---------------------------------------------------------------- racha y aptitud

async function streakFor(astronautId, nowMs = Date.now()) {
  const since = new Date(Math.floor(nowMs / DAY_MS) * DAY_MS - 400 * DAY_MS).toISOString();
  const found = (await wellbeing.checkinDays([astronautId], since)).get(astronautId);
  return streakFrom(found ? found.days : [], nowMs);
}

/** Inicio de la ventana de aptitud: PVT medida desde aquí (WELLBEING_FITNESS_MAX_AGE_H). */
const fitnessSince = (nowMs = Date.now()) =>
  new Date(nowMs - env.wellbeing.fitnessMaxAgeH * 3600 * 1000).toISOString();

/**
 * Aptitud para tarea crítica por astronauta: la de la PVT más reciente de las últimas
 * WELLBEING_FITNESS_MAX_AGE_H horas (fit si los 3 indicadores PVT quedaron en normal); sin
 * PVT reciente, not_confirmed. Es lo único de la PVT que ven admin y el flight surgeon.
 */
async function fitnessByAstronaut(astronautIds, nowMs = Date.now()) {
  const recent = await wellbeing.recentFitness(astronautIds, fitnessSince(nowMs));
  return new Map(astronautIds.map((id) => [id, recent.get(id) || 'not_confirmed']));
}

// ---------------------------------------------------------------- escritura

/** El astronauta con asignación, o 403. */
async function ownActor(userId) {
  const actor = await loadActor(userId);
  if (!actor || actor.role !== 'astronaut' || !actor.astronaut_id || !actor.mission_ids.length) {
    throw new HttpError(403, 'NO_ACTIVE_ASSIGNMENT', 'No tienes una asignación de misión vigente.');
  }
  return actor;
}

/**
 * Check-in diario (POST /wellbeing/checkins y entity wellbeing_checkin). Devuelve
 * { status: 201 | 200, body: WellbeingAck } con el mensaje neutro de la regla, la racha y
 * supersedes_id (no null = corrigió el check-in de ese día).
 */
async function submitCheckin({ userId, body, clientUuid, prefix = '' }) {
  const input = validateCheckin(body, { prefix, clientUuid });
  const sliders = Object.fromEntries(
    Object.entries(input.sliders).map(([code, value]) => [
      code,
      { value, client_uuid: groupUuid(input.client_uuid, code) },
    ]),
  );
  let out;
  try {
    out = await recorder.recordCheckin({
      userId,
      checkin: {
        client_uuid: input.client_uuid,
        measured_at: input.measured_at,
        sleep_hours: input.sleep_hours,
        sleep_uuid: groupUuid(input.client_uuid, 'SLEEP_HOURS'),
        sleep_input_method: 'wearable',
        private_note: input.private_note,
        sliders,
      },
    });
  } catch (err) {
    throw renameFields(err, prefix);
  }
  const evaluations =
    out.status === 'accepted'
      ? out.readings
      : await wellbeing.groupEvaluations('wellbeing_checkin_id', out.group_id);
  const [streak, last] = await Promise.all([
    streakFor(out.astronaut_id),
    wellbeing.lastScreenings(out.astronaut_id),
  ]);
  return {
    status: out.status === 'accepted' ? 201 : 200,
    body: {
      id: out.group_id,
      client_uuid: input.client_uuid,
      received_at: out.received_at,
      message: neutralMessage(
        evaluations.filter((e) => e.indicator_code.startsWith('WB_')),
        MESSAGES.checkin,
      ),
      // Siempre: el botón "Quiero hablar con alguien" no depende del resultado.
      offer_support: true,
      supersedes_id: out.supersedes_id ?? null,
      streak,
      screening_due: screeningDue(last),
    },
  };
}

/** Cuestionario PHQ-2 o GAD-2 (POST /wellbeing/screenings y entity wellbeing_screening). */
async function submitScreening({ userId, body, clientUuid, prefix = '' }) {
  const input = validateScreening(body, { prefix, clientUuid });
  const code = `${input.instrument}_SCORE`;
  let out;
  try {
    out = await recorder.recordInstrument({
      userId,
      administration: {
        client_uuid: input.client_uuid,
        instrument: input.instrument,
        answers: input.answers,
        measured_at: input.measured_at,
        reading_uuid: groupUuid(input.client_uuid, code),
      },
    });
  } catch (err) {
    throw renameFields(err, prefix);
  }
  const evaluations =
    out.status === 'accepted'
      ? out.readings
      : await wellbeing.groupEvaluations('instrument_administration_id', out.group_id);
  return {
    status: out.status === 'accepted' ? 201 : 200,
    body: {
      id: out.group_id,
      client_uuid: input.client_uuid,
      received_at: out.received_at,
      // Nunca el puntaje: solo el mensaje neutro de la regla.
      message: neutralMessage(evaluations, MESSAGES.screening),
      offer_support: true,
    },
  };
}

/** Corrida PVT (POST /wellbeing/pvt-runs y entity pvt_run). Solo devuelve la aptitud. */
async function submitPvtRun({ userId, body, clientUuid, prefix = '' }) {
  const input = validatePvt(body, { prefix, clientUuid });
  let out;
  try {
    out = await recorder.recordPvtRun({
      userId,
      run: {
        client_uuid: input.client_uuid,
        device_id: input.device_id,
        measured_at: input.measured_at,
        before_critical_task: input.before_critical_task,
        duration_s: input.duration_s,
        trials: input.trials,
        readings: Object.entries(PVT_METRICS).map(([field, code]) => ({
          indicator_code: code,
          value: input.metrics[field],
          client_uuid: groupUuid(input.client_uuid, code),
        })),
      },
    });
  } catch (err) {
    throw renameFields(err, prefix);
  }
  const fitness = out.fitness || (await wellbeing.pvtFitness(out.group_id));
  return {
    status: out.status === 'accepted' ? 201 : 200,
    body: {
      id: out.group_id,
      client_uuid: input.client_uuid,
      received_at: out.received_at,
      fitness,
      message: fitness === 'fit' ? MESSAGES.pvtFit : MESSAGES.pvtNotConfirmed,
    },
  };
}

/** Nombres de campo del registro → los del body (WB_MOOD.value → mood). */
function renameFields(err, prefix) {
  if (!(err instanceof HttpError) || !Array.isArray(err.details)) return err;
  const metric = Object.fromEntries(Object.entries(PVT_METRICS).map(([f, c]) => [c, f]));
  err.details = err.details.map((d) => {
    const [code, part] = String(d.field).split('.');
    const field =
      SLIDER_FIELDS[code] ||
      metric[code] ||
      (code === 'SLEEP_HOURS' ? 'sleep_hours' : null) ||
      (part && /_SCORE$/.test(code) ? (part === 'value' ? 'item_1' : part) : null) ||
      d.field;
    return { ...d, field: `${prefix}${field}` };
  });
  return err;
}

// ---------------------------------------------------------------- lectura

/** GET /wellbeing/instruments?lang=es|en: texto oficial, licencia y fuentes. */
async function listInstruments({ query }) {
  const lang = query.lang ?? 'es';
  if (!['es', 'en'].includes(lang)) {
    throw badRequest([{ field: 'lang', issue: 'debe ser uno de: es, en' }]);
  }
  const rows = await wellbeing.activeInstruments();
  return {
    items: rows.map((row) => {
      const def = row.definition || {};
      const base = def.lang === lang ? def : (def.translations || {})[lang];
      const text = base || def;
      const item = {
        code: row.code,
        name: row.name,
        indicator_code: row.indicator_code,
        lang: base ? lang : def.lang,
        official: Boolean(base && text.official),
        language_version: text.language_version || null,
        prompt: text.prompt,
        items: text.items,
        options: text.options,
        license: row.license,
        sources: row.sources,
      };
      if (!base) item.note = `Sin texto en "${lang}": se devuelve el idioma por defecto.`;
      return item;
    }),
  };
}

const HISTORY_KEY = (c) =>
  typeof c.t === 'string' && !Number.isNaN(Date.parse(c.t)) && isUuid(c.id);

function toHistoryItem(row) {
  const item = { id: row.id, kind: row.kind, measured_at: row.at };
  if (row.kind === 'checkin') {
    const v = row.vals || {};
    item.checkin = {
      mood: v.WB_MOOD ?? null,
      fatigue: v.WB_FATIGUE ?? null,
      stress: v.WB_STRESS ?? null,
      crew_conflict: v.WB_CREW_CONFLICT ?? null,
      sleep_hours: row.sleep_hours == null ? null : Number(row.sleep_hours),
      private_note: row.private_note,
    };
  } else if (row.kind === 'screening') {
    item.instrument = row.instrument;
  } else if (row.kind === 'pvt_run') {
    item.fitness = row.fitness;
  } else {
    item.support_status = row.support_status;
  }
  return item;
}

function parseRange(query) {
  const problems = [];
  for (const field of ['from', 'to']) {
    if (query[field] !== undefined && Number.isNaN(Date.parse(query[field]))) {
      problems.push({ field, issue: 'debe ser una fecha ISO 8601' });
    }
  }
  const issue = limitIssue(query.limit);
  if (issue) problems.push({ field: 'limit', issue });
  if (problems.length) throw badRequest(problems);
  return {
    from: query.from ? new Date(query.from).toISOString() : null,
    to: query.to ? new Date(query.to).toISOString() : null,
  };
}

/** GET /me/wellbeing: lo que el propio astronauta registró. Sin niveles ni puntajes. */
async function myHistory({ userId, query }) {
  const range = parseRange(query);
  const limit = parseLimit(query.limit);
  const after = decodeCursor(query.cursor, HISTORY_KEY);
  const actor = await ownActor(userId);
  // Sus propios datos: accessPolicy lo permite y no se registra en la bitácora (no es de otro).
  const own = {
    astronaut_id: actor.astronaut_id,
    mission_id: actor.mission_ids[0],
    sensitivity: 'confidential',
    category: 'behavioral',
    action: 'read',
  };
  if (!canAccess(actor, own)) throw forbidden();
  const rows = await wellbeing.historyPage({
    astronautId: actor.astronaut_id,
    ...range,
    after,
    limit,
  });
  return toPage(rows, limit, (r) => ({ t: r.at_text, id: r.id }), toHistoryItem);
}

module.exports = {
  submitCheckin,
  submitScreening,
  submitPvtRun,
  listInstruments,
  myHistory,
  fitnessByAstronaut,
  streakFor,
  ownActor,
  // puras (pruebas)
  neutralMessage,
  streakFrom,
  screeningDue,
  validateCheckin,
  CHECKIN_SLIDERS,
  MESSAGES,
};
