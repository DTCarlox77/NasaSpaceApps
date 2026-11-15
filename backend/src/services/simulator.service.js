'use strict';

/**
 * Simulador de datos SINTÉTICOS para la demo (tarea 7).
 *
 * - loadHistory: historia normal de N días (src/simulator/history.js).
 * - runScenario: un escenario "ahora" encima de la historia (src/simulator/scenarios.js).
 *
 * Nada se escribe con SQL directo a readings: cada registro entra por el servicio real, como
 * el usuario que lo registraría (cada astronauta y la cuenta de servicio del hábitat). Así se
 * validan, se evalúan con las reglas activas, se calculan los derivados y se crean los
 * escalamientos igual que en la vida real. Todo queda con synthetic = true (default).
 *
 * Confidencialidad: el resumen solo informa niveles y escalamientos de lo ESTÁNDAR. De
 * bienestar solo cuenta registros (como el cumplimiento): los niveles y los escalamientos a
 * behavioral_health no salen del servidor por aquí.
 */
const { HttpError, badRequest, conflict, notFound } = require('../utils/httpError');
const { generateHistory, WB_CODES } = require('../simulator/history');
const { buildScenario, SCENARIOS, INTENSITIES } = require('../simulator/scenarios');
const { MODULES } = require('../simulator/profiles');
const simulator = require('../models/simulator.model');
const wellbeing = require('../models/wellbeing.model');
const readingsService = require('./readings.service');
const habitatService = require('./habitat.service');
const recorder = require('./wellbeingRecorder');

const MISSION_CODE = 'ARES-1';
const MAX_DAYS = 60;
const HABITAT_BATCH = 500;

// ---------------------------------------------------------------- contexto

async function missionContext() {
  const mission = await simulator.missionByCode(MISSION_CODE);
  if (!mission)
    throw conflict('CONFLICT', `No existe la misión ${MISSION_CODE}: corre el seed de demo.`);
  const crew = await simulator.currentCrew(mission.id);
  if (!crew.length) throw conflict('CONFLICT', `${MISSION_CODE} no tiene tripulación vigente.`);
  const serviceUserId = await simulator.serviceUser(mission.id);
  return { mission, crew, serviceUserId, byCallSign: new Map(crew.map((m) => [m.call_sign, m])) };
}

// ---------------------------------------------------------------- conteo

function newTally() {
  return {
    readings: { created: 0, duplicate: 0, rejected: 0 },
    wellbeing: {
      checkins: { created: 0, duplicate: 0 },
      checkin_corrections: 0,
      pvt_runs: { created: 0, duplicate: 0 },
      instruments: { created: 0, duplicate: 0 },
    },
    levels: {},
    readingIds: [],
    errors: [],
  };
}

function countReading(tally, { status, code, level, id, confidential }) {
  if (status === 'rejected') {
    tally.readings.rejected += 1;
    return;
  }
  tally.readings[status === 'accepted' ? 'created' : 'duplicate'] += 1;
  if (status !== 'accepted') return;
  tally.readingIds.push(id);
  if (confidential) return; // los niveles de bienestar no se informan
  const byLevel = (tally.levels[code] = tally.levels[code] || {});
  byLevel[level] = (byLevel[level] || 0) + 1;
}

function reject(tally, item, err) {
  if (!(err instanceof HttpError)) throw err;
  tally.readings.rejected += 1;
  if (tally.errors.length < 5) {
    tally.errors.push({
      type: item.type,
      indicator_code: item.indicator_code || null,
      code: err.code,
      details: err.details,
    });
  }
}

// ---------------------------------------------------------------- escritura

async function writeReading(item, ctx, tally) {
  const user = ctx.byCallSign.get(item.call_sign);
  try {
    const { status, body } = await readingsService.createReading({
      userId: user.user_id,
      input: {
        client_uuid: item.client_uuid,
        indicator_code: item.indicator_code,
        measured_at: item.measured_at,
        values: item.values,
        input_method: item.input_method,
        device_id: item.device_id,
      },
    });
    countReading(tally, {
      status: status === 201 ? 'accepted' : 'duplicate',
      code: item.indicator_code,
      level: body.evaluation.level,
      id: body.reading.id,
    });
  } catch (err) {
    reject(tally, item, err);
  }
}

function countGroup(tally, group, result) {
  const key = result.status === 'accepted' ? 'created' : 'duplicate';
  tally.wellbeing[group][key] += 1;
  if (result.status !== 'accepted') tally.readings.duplicate += result.reading_count || 0;
  for (const r of result.readings) {
    countReading(tally, {
      status: 'accepted',
      code: r.indicator_code,
      level: r.level,
      id: r.reading_id,
      confidential: r.sensitivity === 'confidential',
    });
  }
}

async function writeGroup(item, ctx, tally) {
  const userId = ctx.byCallSign.get(item.call_sign).user_id;
  try {
    if (item.type === 'checkin') {
      countGroup(tally, 'checkins', await recorder.recordCheckin({ userId, checkin: item }));
    } else if (item.type === 'pvt') {
      countGroup(tally, 'pvt_runs', await recorder.recordPvtRun({ userId, run: item }));
    } else if (item.type === 'instrument') {
      countGroup(
        tally,
        'instruments',
        await recorder.recordInstrument({ userId, administration: item }),
      );
    }
  } catch (err) {
    reject(tally, item, err);
  }
}

/**
 * Un día de wellbeing_decline: corrige los deslizadores del check-in de ese día si existe
 * (supersedes_uuid, mismo measured_at) o crea un check-in nuevo.
 */
async function writeDeclineDay(item, ctx, tally, current) {
  const member = ctx.byCallSign.get(item.call_sign);
  const existing = current.get(item.date);
  try {
    if (existing && WB_CODES.every((code) => existing.has(code))) {
      const first = existing.get(WB_CODES[0]);
      const { readings } = await recorder.correctCheckin({
        userId: member.user_id,
        checkinId: first.wellbeing_checkin_id,
        corrections: WB_CODES.map((code) => ({
          client_uuid: item.sliders[code].client_uuid,
          supersedes_uuid: existing.get(code).client_uuid,
          indicator_code: code,
          value: item.sliders[code].value,
          measured_at: new Date(existing.get(code).measured_at).toISOString(),
        })),
      });
      for (const r of readings) {
        if (r.status === 'accepted') tally.wellbeing.checkin_corrections += 1;
        countReading(tally, {
          status: r.status,
          code: r.indicator_code,
          id: r.reading_id,
          confidential: true,
        });
      }
    } else {
      countGroup(
        tally,
        'checkins',
        await recorder.recordCheckin({
          userId: member.user_id,
          checkin: {
            client_uuid: item.checkin_uuid,
            measured_at: item.measured_at,
            sliders: item.sliders,
          },
        }),
      );
    }
  } catch (err) {
    reject(tally, item, err);
  }
}

/** Check-ins vigentes por día UTC → (código → lectura), para corregirlos. */
async function currentCheckins(ctx, callSign, fromDate) {
  const rows = await wellbeing.currentSliderReadings({
    astronautId: ctx.byCallSign.get(callSign).astronaut_id,
    codes: WB_CODES,
    from: `${fromDate}T00:00:00Z`,
  });
  const byDay = new Map();
  for (const row of rows) {
    const date = new Date(row.measured_at).toISOString().slice(0, 10);
    if (!byDay.has(date)) byDay.set(date, new Map());
    byDay.get(date).set(row.indicator_code, row); // la más reciente del día queda al final
  }
  return byDay;
}

async function writeHabitat(items, ctx, tally) {
  if (!items.length) return;
  if (!ctx.serviceUserId) {
    throw conflict('CONFLICT', `${MISSION_CODE} no tiene cuenta de servicio del hábitat.`);
  }
  for (let i = 0; i < items.length; i += HABITAT_BATCH) {
    const batch = items.slice(i, i + HABITAT_BATCH);
    const { results } = await habitatService.createHabitatReadings({
      userId: ctx.serviceUserId,
      body: {
        readings: batch.map((item) => ({
          client_uuid: item.client_uuid,
          indicator_code: item.indicator_code,
          module_id: item.module_id,
          value: item.value,
          ...(item.period ? { period: item.period } : {}),
          source: item.source,
          measured_at: item.measured_at,
        })),
      },
    });
    results.forEach((r, k) => {
      if (r.status === 'rejected') {
        reject(tally, batch[k], new HttpError(400, r.error.code, r.error.message, r.error.details));
        return;
      }
      countReading(tally, {
        status: r.status,
        code: batch[k].indicator_code,
        level: r.evaluation.level,
        id: r.reading_id,
      });
    });
  }
}

/**
 * Escribe los items en orden de measured_at. Cada sujeto (astronauta o el hábitat) va en su
 * propia cola, en serie (los derivados leen sus lecturas anteriores); las colas corren en
 * paralelo porque no comparten historial.
 */
async function writeItems(items, ctx) {
  const tally = newTally();
  const queues = new Map();
  for (const item of items) {
    const subject = item.type === 'habitat' ? 'habitat' : item.call_sign;
    if (!queues.has(subject)) queues.set(subject, []);
    queues.get(subject).push(item);
  }
  await Promise.all(
    [...queues.entries()].map(async ([subject, queue]) => {
      if (subject === 'habitat') return writeHabitat(queue, ctx, tally);
      const declineDays = queue.filter((i) => i.type === 'wellbeing_day');
      const current = declineDays.length
        ? await currentCheckins(ctx, subject, declineDays[0].date)
        : null;
      for (const item of queue) {
        if (item.type === 'reading') await writeReading(item, ctx, tally);
        else if (item.type === 'wellbeing_day') await writeDeclineDay(item, ctx, tally, current);
        else await writeGroup(item, ctx, tally);
      }
    }),
  );
  return tally;
}

async function summarize(tally, extra) {
  const counts = await simulator.escalationCounts(tally.readingIds);
  const levels = Object.fromEntries(
    Object.keys(tally.levels)
      .sort()
      .map((code) => [code, tally.levels[code]]),
  );
  return {
    ...extra,
    readings: tally.readings,
    wellbeing: tally.wellbeing,
    levels,
    escalations: {
      created: counts.reduce((s, r) => s + r.count, 0),
      by_level: Object.fromEntries(counts.map((r) => [r.level, r.count])),
    },
    confidential_note:
      'Los niveles y escalamientos de bienestar son confidenciales: solo los ve behavioral_health.',
    errors: tally.errors,
  };
}

// ---------------------------------------------------------------- validación

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function historyParams(body) {
  const input = isPlainObject(body) ? body : {};
  const problems = [];
  const days = input.days ?? 14;
  const seed = input.seed ?? 42;
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    problems.push({ field: 'days', issue: `debe ser un entero entre 1 y ${MAX_DAYS}` });
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
    problems.push({ field: 'seed', issue: 'debe ser un entero entre 0 y 2147483647' });
  }
  if (problems.length) throw badRequest(problems);
  return { days, seed };
}

function scenarioParams(name, body, ctx) {
  if (!SCENARIOS.includes(name)) {
    throw notFound(`El escenario ${name} no existe. Escenarios: ${SCENARIOS.join(', ')}.`);
  }
  const input = isPlainObject(body) ? body : {};
  const problems = [];
  const params = {};
  if (input.intensity !== undefined && !INTENSITIES.includes(input.intensity)) {
    problems.push({ field: 'intensity', issue: `debe ser uno de: ${INTENSITIES.join(', ')}` });
  } else if (input.intensity !== undefined) params.intensity = input.intensity;
  if (input.astronaut !== undefined && input.astronaut !== null) {
    const callSign =
      typeof input.astronaut === 'string' ? input.astronaut.trim().toUpperCase() : '';
    if (!ctx.byCallSign.has(callSign)) {
      problems.push({
        field: 'astronaut',
        issue: `debe ser un call sign de la tripulación: ${[...ctx.byCallSign.keys()].join(', ')}`,
      });
    } else params.astronaut = callSign;
  }
  if (input.module_id !== undefined && input.module_id !== null) {
    if (!Object.keys(MODULES).includes(input.module_id)) {
      problems.push({
        field: 'module_id',
        issue: `debe ser uno de: ${Object.keys(MODULES).join(', ')}`,
      });
    } else params.module_id = input.module_id;
  }
  if (input.contagion !== undefined && typeof input.contagion !== 'boolean') {
    problems.push({ field: 'contagion', issue: 'debe ser true o false' });
  } else if (input.contagion !== undefined) params.contagion = input.contagion;
  if (problems.length) throw badRequest(problems);
  return params;
}

// ---------------------------------------------------------------- radiación

const sumBefore = (events, ms) =>
  events.reduce((s, e) => s + (new Date(e.measured_at).getTime() < ms ? e.value : 0), 0);

/**
 * La historia calcula RAD_DOSE_CUM solo con dosis normales: aquí se le suman las dosis de los
 * eventos solares ya registrados antes de cada lectura, para que la acumulada no baje después
 * de un solar_event. Sin eventos, los valores quedan igual (determinismo).
 */
async function withEventDoses(items, ctx) {
  const state = await simulator.radiationState(ctx.crew.map((m) => m.astronaut_id));
  return items.map((item) => {
    if (item.type !== 'reading' || item.indicator_code !== 'RAD_DOSE_CUM') return item;
    const { events } = state.get(ctx.byCallSign.get(item.call_sign).astronaut_id);
    const extra = sumBefore(events, new Date(item.measured_at).getTime());
    if (!extra) return item;
    return { ...item, values: { value: Math.round((item.values.value + extra) * 100) / 100 } };
  });
}

/** Acumulada de cada tripulante antes de un evento: la última + eventos posteriores. */
async function cumulativeBase(ctx) {
  const state = await simulator.radiationState(ctx.crew.map((m) => m.astronaut_id));
  const base = {};
  for (const member of ctx.crew) {
    const { last, events } = state.get(member.astronaut_id);
    if (!last) continue;
    const since = new Date(last.measured_at).getTime();
    const after = events.reduce(
      (s, e) => s + (new Date(e.measured_at).getTime() > since ? e.value : 0),
      0,
    );
    base[member.call_sign] = Math.round((last.value + after) * 100) / 100;
  }
  return base;
}

// ---------------------------------------------------------------- API

/** Historia normal de `days` días que termina en `now`. Idempotente. */
async function loadHistory({ body, now = new Date() } = {}) {
  const { days, seed } = historyParams(body);
  const ctx = await missionContext();
  const history = generateHistory({
    seed,
    days,
    now,
    missionStartsAt: ctx.mission.starts_at,
    crew: ctx.crew,
  });
  const { from, to } = history;
  const items = await withEventDoses(history.items, ctx);
  const tally = await writeItems(items, ctx);
  return summarize(tally, {
    kind: 'history',
    mission_code: MISSION_CODE,
    params: { days, seed },
    from,
    to,
  });
}

/** Dispara un escenario ahora (o en `now`, para las pruebas). */
async function runScenario({ name, body, now = new Date() } = {}) {
  const ctx = await missionContext();
  const params = scenarioParams(name, body, ctx);
  const radiation = name === 'solar_event' ? await cumulativeBase(ctx) : undefined;
  const scenario = buildScenario(name, { now, crew: ctx.crew, radiation, ...params });
  if (scenario.params.astronaut && !ctx.byCallSign.has(scenario.params.astronaut)) {
    throw badRequest([
      {
        field: 'astronaut',
        issue: `${scenario.params.astronaut} no está en la tripulación vigente`,
      },
    ]);
  }
  if (name === 'crew_illness' && scenario.params.contagion && ctx.crew.length < 2) {
    throw badRequest([{ field: 'contagion', issue: 'hace falta un segundo tripulante' }]);
  }
  const tally = await writeItems(scenario.items, ctx);
  return summarize(tally, {
    kind: 'scenario',
    scenario: name,
    mission_code: MISSION_CODE,
    params: scenario.params,
    at: new Date(new Date(now).getTime() - (new Date(now).getTime() % 60000)).toISOString(),
    notes: scenario.notes,
  });
}

module.exports = { loadHistory, runScenario, SCENARIOS, MISSION_CODE };
