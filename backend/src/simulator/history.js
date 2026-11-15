'use strict';

/**
 * Historia sintética normal de una misión (pura: no toca la base).
 *
 * generateHistory({ seed, days, now, missionStartsAt, crew, modules }) devuelve los registros
 * de los últimos `days` días (que terminan en `now`, en UTC), ordenados por measured_at:
 *   - signos vitales diarios (presión, FC en reposo, FR, SpO₂, temperatura);
 *   - check-in diario de bienestar (WB_*) con las horas de sueño de la noche (SLEEP_HOURS);
 *   - ejercicio diario, glucosa en ayunas cada 2–3 días y masa semanal;
 *   - dosis de radiación diaria y acumulada (dosímetro personal);
 *   - PVT semanal (más 3 corridas de línea base al inicio de la misión) y PHQ-2/GAD-2 cada
 *     2 semanas;
 *   - hábitat cada hora por módulo (CO₂, temperatura, humedad y ruido con period work/sleep).
 *
 * Cada valor y cada client_uuid salen de la clave (semilla + sujeto + indicador + fecha): la
 * misma semilla da los mismos datos y volver a correr no duplica. Los horarios por astronauta
 * son una suposición de diseño. Nada se genera después de `now` ni antes del inicio de la misión.
 */
const { rngFor, uuidFor, clamp, round } = require('./random');
const P = require('./profiles');

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const WB_CODES = ['WB_MOOD', 'WB_FATIGUE', 'WB_STRESS', 'WB_CREW_CONFLICT'];
const PVT_TRIALS = 52; // 3 min de PVT-B ≈ 50 estímulos (pvtb_basner); suposición de diseño

const epochDay = (time) => Math.floor(time / DAY_MS);
const isoDate = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const at = (day, hour, minute) => day * DAY_MS + (hour * 60 + minute) * MIN_MS;

/** Dosis diaria (mSv) de un astronauta en un día UTC: la usan la diaria y la acumulada. */
function dailyDose(seed, callSign, day) {
  const profile = P.profileFor(callSign);
  const rng = rngFor(seed, callSign, 'RAD_DOSE_DAILY', day);
  const value = rng.normal(P.RAD_DAILY_MSV * profile.rad_factor, P.SD.rad);
  return round(clamp(value, ...P.LIMITS.RAD_DOSE_DAILY), 3);
}

/** Dosis acumulada al cierre del día: carrera previa + dosis diarias desde el inicio. */
function cumulativeDose(seed, callSign, firstMissionDay, day) {
  let sum = P.profileFor(callSign).rad_prior_msv;
  for (let d = firstMissionDay; d <= day; d += 1) sum += dailyDose(seed, callSign, d);
  return round(sum, 2);
}

/** Valor normal recortado a los límites de la historia. */
const normalIn = (rng, mean, sd, limits, decimals = 0) =>
  round(clamp(rng.normal(mean, sd), ...limits), decimals);

function astronautDay({ seed, callSign, index, day, firstMissionDay }) {
  const p = P.profileFor(callSign);
  const date = isoDate(day);
  const key = (code) => rngFor(seed, callSign, code, date);
  const id = (...parts) => uuidFor(seed, 'history', callSign, ...parts, date);
  const jitter = (code, max) => rngFor(seed, callSign, code, date, 't').int(0, max);
  const items = [];
  const reading = (code, values, inputMethod, hour, minute, extra = {}) => ({
    type: 'reading',
    call_sign: callSign,
    client_uuid: id(code),
    indicator_code: code,
    values,
    input_method: inputMethod,
    device_id: extra.device_id || 'sim-wearable',
    measured_at: at(day, hour, minute),
  });

  // Check-in de la mañana (07:00–07:20): las horas de sueño de la noche y los deslizadores.
  const wbRng = key('WB');
  items.push({
    type: 'checkin',
    call_sign: callSign,
    client_uuid: id('checkin'),
    measured_at: at(day, 7, jitter('checkin', 20)),
    sleep_hours: normalIn(key('SLEEP_HOURS'), p.sleep, P.SD.sleep, P.LIMITS.SLEEP_HOURS, 1),
    sleep_uuid: id('SLEEP_HOURS'),
    sliders: Object.fromEntries(
      WB_CODES.map((code) => [
        code,
        { value: normalIn(wbRng, p.wb[code], P.SD.wb, P.LIMITS.WB), client_uuid: id(code) },
      ]),
    ),
  });

  // Signos vitales (07:25–07:50).
  const vitalsAt = 25 + jitter('vitals', 15);
  const bp = key('BLOOD_PRESSURE');
  items.push(
    reading(
      'BLOOD_PRESSURE',
      {
        systolic: normalIn(bp, p.bp[0], P.SD.systolic, P.LIMITS.systolic),
        diastolic: normalIn(bp, p.bp[1], P.SD.diastolic, P.LIMITS.diastolic),
        symptoms: [],
      },
      'manual',
      7,
      vitalsAt,
    ),
    reading(
      'HEART_RATE',
      {
        value: normalIn(key('HEART_RATE'), p.hr, P.SD.hr, P.LIMITS.HEART_RATE),
        at_rest: true,
        symptoms: [],
      },
      'wearable',
      7,
      vitalsAt + 1,
    ),
    reading(
      'RESP_RATE',
      { value: normalIn(key('RESP_RATE'), p.rr, P.SD.rr, P.LIMITS.RESP_RATE) },
      'wearable',
      7,
      vitalsAt + 2,
    ),
    reading(
      'SPO2',
      { value: normalIn(key('SPO2'), p.spo2, P.SD.spo2, P.LIMITS.SPO2) },
      'wearable',
      7,
      vitalsAt + 3,
    ),
    reading(
      'BODY_TEMP',
      { value: normalIn(key('BODY_TEMP'), p.temp, P.SD.temp, P.LIMITS.BODY_TEMP, 1) },
      'manual',
      7,
      vitalsAt + 4,
    ),
  );

  // Glucosa en ayunas cada 2–3 días (07:15): días 0 y 2 de cada ciclo de 5.
  if ([0, 2].includes((day + index) % 5)) {
    items.push(
      reading(
        'GLUCOSE',
        {
          value: normalIn(key('GLUCOSE'), p.glucose, P.SD.glucose, P.LIMITS.GLUCOSE),
          fasting: true,
          symptoms: [],
        },
        'manual',
        7,
        15,
      ),
    );
  }

  // Masa semanal (06:50), sin tendencia: ±0.25 kg alrededor de la línea base.
  if ((day + index) % 7 === 3) {
    items.push(
      reading(
        'BODY_MASS',
        { value: normalIn(key('BODY_MASS'), p.mass, P.SD.mass, [p.mass - 1, p.mass + 1], 1) },
        'manual',
        6,
        50,
      ),
    );
  }

  // Ejercicio del día (18:00–18:30), en bloques de 5 min.
  const minutes = normalIn(key('EXERCISE_MIN'), p.exercise, P.SD.exercise, P.LIMITS.EXERCISE_MIN);
  items.push(
    reading(
      'EXERCISE_MIN',
      {
        value: Math.round(minutes / 5) * 5,
        type: (day + index) % 2 === 0 ? 'aerobic' : 'resistive',
      },
      'wearable',
      18,
      jitter('exercise', 30),
    ),
  );

  // Dosímetro personal: dosis del día y acumulada al cierre (23:45 y 23:46).
  items.push(
    reading(
      'RAD_DOSE_DAILY',
      { value: dailyDose(seed, callSign, day), event_active: false, symptoms: [] },
      'sensor',
      23,
      45,
      { device_id: `sim-dosimeter-${callSign.toLowerCase()}` },
    ),
    reading(
      'RAD_DOSE_CUM',
      { value: cumulativeDose(seed, callSign, firstMissionDay, day) },
      'sensor',
      23,
      46,
      { device_id: `sim-dosimeter-${callSign.toLowerCase()}` },
    ),
  );

  // PVT semanal (09:00) en condiciones de descanso. Sus valores rotan entre los de la línea
  // base, así el z contra el dispositivo nunca llega a 2 (suposición de diseño).
  if ((day + index) % 7 === 5) {
    items.push(pvtRun({ seed, callSign, day, slot: Math.floor(day / 7) % 3, kind: 'weekly' }));
  }

  // PHQ-2 y GAD-2 cada 2 semanas (20:00), con respuestas 0–1 (puntaje < 3).
  if ((day + index) % 14 === 6) {
    const rng = key('INSTRUMENTS');
    for (const [instrument, code] of [
      ['PHQ2', 'PHQ2_SCORE'],
      ['GAD2', 'GAD2_SCORE'],
    ]) {
      items.push({
        type: 'instrument',
        call_sign: callSign,
        client_uuid: id(instrument),
        reading_uuid: id(code),
        instrument,
        indicator_code: code,
        answers: { item_1: rng.int(0, 1), item_2: rng.int(0, 1) },
        measured_at: at(day, 20, instrument === 'PHQ2' ? 0 : 3),
      });
    }
  }
  return items;
}

/**
 * Una corrida PVT. kind = 'baseline' (las 3 del inicio de la misión) o 'weekly'; slot elige
 * cuál de los 3 valores de la línea base usar.
 */
function pvtRun({ seed, callSign, day, slot, kind }) {
  const p = P.profileFor(callSign).pvt;
  const date = isoDate(day);
  const id = (part) => uuidFor(seed, 'history', callSign, 'PVT', kind, part, date);
  return {
    type: 'pvt',
    call_sign: callSign,
    client_uuid: id('run'),
    device_id: P.PVT_DEVICE,
    before_critical_task: false,
    duration_s: 180,
    trials: PVT_TRIALS,
    measured_at: at(day, 9, 0),
    readings: [
      { indicator_code: 'PVT_LAPSES', value: p.lapses[slot], client_uuid: id('PVT_LAPSES') },
      { indicator_code: 'PVT_MEAN_RT', value: p.mean_rt[slot], client_uuid: id('PVT_MEAN_RT') },
      {
        indicator_code: 'PVT_FALSE_STARTS',
        value: p.false_starts[slot],
        client_uuid: id('PVT_FALSE_STARTS'),
      },
    ],
  };
}

function habitatHour({ seed, moduleId, module, day, hour }) {
  const date = isoDate(day);
  const slot = `${date}T${String(hour).padStart(2, '0')}`;
  const rng = rngFor(seed, moduleId, 'HAB', slot);
  const sleep = P.isSleepHour(hour);
  const minute = module.offset_min;
  // CO₂: la tripulación lo sube en horas de trabajo (+0.25) y baja en el sueño (−0.2).
  const co2 = normalIn(rng, module.co2 + (sleep ? -0.2 : 0.25), 0.15, P.LIMITS.HAB_CO2, 2);
  const values = [
    ['HAB_CO2', co2],
    ['HAB_TEMP', normalIn(rng, module.temp, 0.4, P.LIMITS.HAB_TEMP, 1)],
    ['HAB_HUMIDITY', normalIn(rng, module.humidity, 3, P.LIMITS.HAB_HUMIDITY)],
    [
      'HAB_NOISE',
      sleep
        ? normalIn(rng, module.noise_sleep, 1.2, P.LIMITS.NOISE_SLEEP, 1)
        : normalIn(rng, module.noise_work, 1.5, P.LIMITS.NOISE_WORK, 1),
    ],
  ];
  return values.map(([code, value], i) => ({
    type: 'habitat',
    client_uuid: uuidFor(seed, 'history', moduleId, code, slot),
    indicator_code: code,
    module_id: moduleId,
    value,
    ...(code === 'HAB_NOISE' ? { period: sleep ? 'sleep' : 'work' } : {}),
    source: 'simulator',
    measured_at: at(day, hour, minute + i),
  }));
}

/**
 * crew = [{ call_sign }] (orden estable: el índice desfasa los días de cada rutina).
 * missionStartsAt: inicio de la misión (no se genera nada antes). Devuelve
 * { from, to, items } con measured_at en ISO y los items ordenados.
 */
function generateHistory({
  seed = 42,
  days = 14,
  now = new Date(),
  missionStartsAt,
  crew,
  modules = P.MODULES,
}) {
  const nowMs = new Date(now).getTime();
  const today = epochDay(nowMs);
  const firstMissionDay = missionStartsAt ? epochDay(new Date(missionStartsAt).getTime()) : null;
  const firstDay = Math.max(today - (days - 1), firstMissionDay ?? -Infinity);
  const startMs = missionStartsAt ? new Date(missionStartsAt).getTime() : -Infinity;
  const fromMs = Math.max(firstDay * DAY_MS, startMs);
  const items = [];

  crew.forEach(({ call_sign: callSign }, index) => {
    for (let day = firstDay; day <= today; day += 1) {
      items.push(
        ...astronautDay({ seed, callSign, index, day, firstMissionDay: firstMissionDay ?? day }),
      );
    }
    // Línea base de la PVT: 3 corridas en los días 1–3 de la misión (suposición de diseño).
    if (firstMissionDay !== null) {
      for (let k = 0; k < 3; k += 1) {
        items.push(
          pvtRun({ seed, callSign, day: firstMissionDay + 1 + k, slot: k, kind: 'baseline' }),
        );
      }
    }
  });
  for (const [moduleId, module] of Object.entries(modules)) {
    for (let day = firstDay; day <= today; day += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        items.push(...habitatHour({ seed, moduleId, module, day, hour }));
      }
    }
  }

  const kept = items
    .filter(
      (item) => item.measured_at <= nowMs && (item.type === 'pvt' || item.measured_at >= fromMs),
    )
    .filter((item) => item.measured_at >= startMs)
    .sort((a, b) => a.measured_at - b.measured_at || a.client_uuid.localeCompare(b.client_uuid))
    .map((item) => ({ ...item, measured_at: new Date(item.measured_at).toISOString() }));
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(nowMs).toISOString(),
    items: kept,
  };
}

module.exports = { generateHistory, dailyDose, cumulativeDose, WB_CODES, epochDay, isoDate };
