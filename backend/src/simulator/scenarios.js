'use strict';

/**
 * Escenarios de la demo (puros): qué registros crear "ahora", encima de la historia normal.
 *
 * buildScenario(name, { now, crew, astronaut, module_id, intensity, contagion }) →
 * { name, params, items, notes }. Los client_uuid salen del escenario, sus parámetros y el
 * minuto de `now`: un reintento en el mismo minuto no duplica, y volver a dispararlo más tarde
 * crea un episodio nuevo (para repetirlo en vivo).
 *
 * Los perfiles de cada escenario (forma de la curva y valores pico) son SUPOSICIÓN DE DISEÑO,
 * elegidos para cruzar los umbrales del catálogo que se quieren mostrar.
 */
const { rngFor, uuidFor, round } = require('./random');
const P = require('./profiles');
const { WB_CODES, isoDate, epochDay } = require('./history');

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;

const SCENARIOS = [
  'solar_event',
  'crew_illness',
  'co2_spike',
  'wellbeing_decline',
  'offline_batch',
  'emergency_solar',
];
const INTENSITIES = ['low', 'high'];

// Valores por defecto de cada escenario (suposición de diseño).
const DEFAULTS = Object.freeze({
  crew_illness: { astronaut: 'LYRA' },
  co2_spike: { module_id: 'HAB-1' },
  wellbeing_decline: { astronaut: 'ATLAS' },
  offline_batch: { astronaut: 'ORION' },
  emergency_solar: { astronaut: 'LYRA' },
});

// Días seguidos de check-ins peores: la regla escala a behavioral_health desde 5
// (adverse_sustained_days ≥ 5). Al 5.º día la línea base (14 días sin los últimos 3) ya
// incluye los 2 primeros días malos y su desviación crece: por eso el empeoramiento es
// progresivo (2 días moderados y 3 más marcados), así el z del 5.º día queda ≈ 2.8 (≥ 1.5).
// Con más días la línea base se "contamina" y el z baja. Brechas: suposición de diseño.
const DECLINE_DAYS = 5;
const DECLINE_GAPS = { low: [35, 35, 50, 50, 50], high: [45, 45, 60, 60, 60] };

function context({ name, now, params }) {
  // Ancla = el minuto de `now`: las horas del escenario y sus client_uuid salen de ella.
  const nowMs = Math.floor(new Date(now).getTime() / MIN_MS) * MIN_MS;
  const anchor = new Date(nowMs).toISOString();
  const parts = [name, params.astronaut || '-', params.module_id || '-', params.intensity, anchor];
  return {
    nowMs,
    id: (...rest) => uuidFor('scenario', ...parts, ...rest),
    rng: (...rest) => rngFor('scenario', ...parts, ...rest),
    iso: (ms) => new Date(Math.min(ms, nowMs)).toISOString(),
  };
}

const reading = (ctx, callSign, code, values, inputMethod, ms, extra = {}) => ({
  type: 'reading',
  call_sign: callSign,
  client_uuid: ctx.id(callSign, code, ms),
  indicator_code: code,
  values,
  input_method: inputMethod,
  device_id: extra.device_id || 'sim-wearable',
  measured_at: ctx.iso(ms),
});

/**
 * solar_event: evento de partículas solares. El dosímetro de cada tripulante marca
 * event_active y 3 lecturas (inicio, subida y pico, cada 45 min). La suma del evento
 * (event_dose_msv) llega a ~140 mSv en low (≥ 125: precaución a flight_surgeon) y a ~285 mSv
 * en high (≥ 250: crítico). Desde la primera lectura, el doble de la mediana diaria da
 * precaución a crew. Con `astronaut`, ese tripulante reporta náusea en el pico: crítico por
 * síntomas (orau_ars, ntrs_ars_spe).
 *
 * Al final, la dosis acumulada (RAD_DOSE_CUM) de cada tripulante: `radiation[callSign]` (la
 * acumulada en la base antes del evento, la calcula el servicio) + la dosis de este evento.
 * Sin ese dato, la dosis de carrera previa del perfil. El límite de carrera (600 mSv) es
 * universal: no depende del sexo (NASA-STD-3001 Vol. 1 [V1 4030]).
 */
function solarEvent(ctx, { crew, astronaut, intensity, radiation = {} }) {
  const profile = intensity === 'high' ? [15, 100, 170] : [8, 50, 85];
  const items = [];
  for (const { call_sign: callSign } of crew) {
    const factor = ctx.rng(callSign, 'factor').uniform(0.92, 1.08); // blindaje de cada puesto
    const device = { device_id: `sim-dosimeter-${callSign.toLowerCase()}` };
    let eventDose = 0;
    profile.forEach((dose, i) => {
      const ms = ctx.nowMs - (profile.length - 1 - i) * 45 * MIN_MS;
      const symptoms = astronaut === callSign && i === profile.length - 1 ? ['nausea'] : [];
      const value = round(dose * factor, 2);
      eventDose += value;
      items.push(
        reading(
          ctx,
          callSign,
          'RAD_DOSE_DAILY',
          { value, event_active: true, symptoms },
          'sensor',
          ms,
          device,
        ),
      );
    });
    const base = radiation[callSign] ?? P.profileFor(callSign).rad_prior_msv;
    items.push(
      reading(
        ctx,
        callSign,
        'RAD_DOSE_CUM',
        { value: round(base + eventDose, 2) },
        'sensor',
        ctx.nowMs,
        device,
      ),
    );
  }
  return {
    items,
    notes: [
      'La suma del evento sigue mientras las lecturas tengan event_active: si lo disparas otra vez, la dosis del evento se acumula.',
      'RAD_DOSE_CUM de cada tripulante suma la dosis del evento a su acumulada.',
    ],
  };
}

/**
 * crew_illness: un tripulante con fiebre (≥ 38.0 °C: precaución a crew; ≥ 39.4 en high:
 * crítico), tos y sensación de fiebre (SYMPTOM: crew) y FC en reposo elevada (≥ 111: crew).
 * Con `contagion`, el primer caso empezó ayer (hace 24 h, con su control de hoy) y un segundo
 * tripulante enferma hoy.
 */
function crewIllness(ctx, { crew, astronaut, intensity, contagion }) {
  const high = intensity === 'high';
  const items = [];
  const sick = (callSign, ms, severity) => {
    const p = P.profileFor(callSign);
    const temp = severity === 'high' ? 39.6 : severity === 'low' ? 38.4 : 38.1;
    const hr = severity === 'high' ? 124 : severity === 'low' ? 112 : 106;
    const symptoms =
      severity === 'mild' ? ['cough', 'sore_throat'] : ['fever_feeling', 'cough', 'fatigue'];
    items.push(
      reading(ctx, callSign, 'BODY_TEMP', { value: temp }, 'manual', ms),
      reading(
        ctx,
        callSign,
        'HEART_RATE',
        { value: hr, at_rest: true, symptoms: [] },
        'wearable',
        ms + MIN_MS,
      ),
      reading(
        ctx,
        callSign,
        'SYMPTOM',
        { symptoms, severity: severity === 'high' ? 3 : 2 },
        'clicks',
        ms + 2 * MIN_MS,
      ),
      reading(
        ctx,
        callSign,
        'RESP_RATE',
        { value: severity === 'high' ? 22 : p.rr + 3 },
        'wearable',
        ms + 3 * MIN_MS,
      ),
    );
  };
  const severity = high ? 'high' : 'low';
  if (contagion) {
    const second = crew.find((m) => m.call_sign !== astronaut);
    sick(astronaut, ctx.nowMs - DAY_MS - 10 * MIN_MS, severity); // ayer
    sick(astronaut, ctx.nowMs - 10 * MIN_MS, severity); // control de hoy
    if (second) sick(second.call_sign, ctx.nowMs - 4 * MIN_MS, 'mild'); // contagio: hoy
  } else {
    sick(astronaut, ctx.nowMs - 4 * MIN_MS, severity);
  }
  return { items, notes: [] };
}

/**
 * co2_spike: falla de la remoción de CO₂ en un módulo. Lecturas cada 10 min durante 50 min:
 * pasa de 3 mmHg y luego de 4.5 (precaución a crew, ochmo_co2). En high sigue hasta ~10.8
 * mmHg (≥ 10: crítico a flight_surgeon, ntrs_co2_smac).
 */
function co2Spike(ctx, { module_id: moduleId, intensity }) {
  const curve =
    intensity === 'high' ? [2.6, 3.5, 5.0, 6.8, 8.9, 10.8] : [2.4, 2.9, 3.4, 4.1, 4.8, 5.2];
  const rng = ctx.rng(moduleId, 'noise');
  const items = curve.map((value, i) => {
    const ms = ctx.nowMs - (curve.length - 1 - i) * 10 * MIN_MS;
    return {
      type: 'habitat',
      client_uuid: ctx.id(moduleId, 'HAB_CO2', ms),
      indicator_code: 'HAB_CO2',
      module_id: moduleId,
      value: round(value + rng.uniform(-0.05, 0.05), 2),
      source: 'simulator',
      measured_at: ctx.iso(ms),
    };
  });
  return { items, notes: [] };
}

/**
 * wellbeing_decline: un tripulante con los deslizadores claramente peores que su línea base
 * durante los últimos 5 días: ánimo más bajo y fatiga, estrés y conflicto más altos, 35 puntos
 * los 2 primeros días y 50 los 3 siguientes (45 y 60 en high).
 * Al 5.º check-in peor, adverse_sustained_days llega a 5: escalamiento CONFIDENCIAL a
 * behavioral_health (nunca a la tripulación ni a admin). En high, además, PHQ-2 = 4 y
 * GAD-2 = 3 (≥ 3: behavioral_health). El servicio corrige el check-in de cada día si existe
 * (supersedes_uuid) o crea uno nuevo. Al final, el tripulante pide hablar con alguien
 * (urgencia `now`, por mensaje): solo lo ve behavioral_health, cuando llega a Tierra.
 */
function wellbeingDecline(ctx, { astronaut, intensity }) {
  const p = P.profileFor(astronaut);
  const gaps = DECLINE_GAPS[intensity] || DECLINE_GAPS.low;
  const today = epochDay(ctx.nowMs);
  const items = [];
  for (let k = DECLINE_DAYS - 1; k >= 0; k -= 1) {
    const day = today - k;
    const gap = gaps[DECLINE_DAYS - 1 - k];
    const rng = ctx.rng(astronaut, 'WB', day);
    const worse = (code) => {
      const sign = code === 'WB_MOOD' ? -1 : 1; // ánimo: más bajo es peor
      return Math.max(0, Math.min(100, Math.round(p.wb[code] + sign * gap + rng.uniform(-3, 3))));
    };
    items.push({
      type: 'wellbeing_day',
      call_sign: astronaut,
      date: isoDate(day),
      measured_at: ctx.iso(day * DAY_MS + 7 * 60 * MIN_MS),
      checkin_uuid: ctx.id(astronaut, 'checkin', day),
      sliders: Object.fromEntries(
        WB_CODES.map((code) => [
          code,
          { value: worse(code), client_uuid: ctx.id(astronaut, code, day) },
        ]),
      ),
    });
  }
  if (intensity === 'high') {
    for (const [instrument, code, answers] of [
      ['PHQ2', 'PHQ2_SCORE', { item_1: 2, item_2: 2 }],
      ['GAD2', 'GAD2_SCORE', { item_1: 2, item_2: 1 }],
    ]) {
      items.push({
        type: 'instrument',
        call_sign: astronaut,
        client_uuid: ctx.id(astronaut, instrument),
        reading_uuid: ctx.id(astronaut, code),
        instrument,
        indicator_code: code,
        answers,
        measured_at: ctx.iso(ctx.nowMs - MIN_MS),
      });
    }
  }
  items.push({
    type: 'support_request',
    call_sign: astronaut,
    client_uuid: ctx.id(astronaut, 'support_request'),
    urgency: 'now',
    channel: 'message',
    content: 'Llevo varios días durmiendo mal y me cuesta concentrarme. ¿Podemos hablar hoy?',
    created_at: ctx.iso(ctx.nowMs),
    measured_at: ctx.iso(ctx.nowMs), // orden: al final, después del 5.º check-in
  });
  return {
    items,
    notes: [
      'Necesita la historia (14 días) para que exista la línea base del bienestar.',
      'Los resultados son confidenciales: solo los ve behavioral_health.',
    ],
  };
}

/**
 * offline_batch: ~24 h sin conexión de un tripulante (ORION) en la tableta TAB-1, empujadas
 * de una vez por POST /sync/push (lo mismo que haría la app al reconectar). El lote trae:
 * - signos vitales del día anterior y de esta mañana, ejercicio, check-in y una PVT;
 * - un CRÍTICO medido hace 6 h (SpO₂ 89 % durante el sueño): se procesa primero, llega con
 *   late_sync y escala desde la recepción (flight_surgeon tras el retraso de la misión);
 * - una CORRECCIÓN (presión mal tecleada, corregida con supersedes_uuid);
 * - un DUPLICADO (el mismo item reenviado al final, como un reintento de la app).
 * Valores alrededor de la línea base del perfil (suposición de diseño).
 */
const OFFLINE_DEVICE = 'TAB-1';

function offlineBatch(ctx, { astronaut }) {
  const callSign = astronaut;
  const p = P.profileFor(callSign);
  const hour = 60 * MIN_MS;
  const items = [];
  const add = (entity, ms, payload, tag = '') => {
    const item = {
      client_uuid: ctx.id(callSign, 'offline', entity, payload.indicator_code || '-', ms, tag),
      entity,
      priority: 'normal',
      created_at: ctx.iso(ms + 5000),
      payload: { ...payload, measured_at: ctx.iso(ms) },
    };
    items.push(item);
    return item;
  };
  const reading = (code, values, inputMethod, hoursAgo, extra = {}) =>
    add(
      'reading',
      ctx.nowMs - hoursAgo * hour,
      {
        indicator_code: code,
        values,
        input_method: inputMethod,
        device_id: OFFLINE_DEVICE,
        ...extra,
      },
      extra.supersedes_uuid ? 'fix' : '',
    );

  const firstHr = reading('HEART_RATE', { value: p.hr + 2, at_rest: true }, 'wearable', 23.5);
  reading('BLOOD_PRESSURE', { systolic: p.bp[0] + 2, diastolic: p.bp[1] + 1 }, 'manual', 23);
  reading('EXERCISE_MIN', { value: 75, type: 'aerobic' }, 'manual', 18);
  reading('RESP_RATE', { value: p.rr }, 'wearable', 14);
  reading('SPO2', { value: 89 }, 'wearable', 6); // crítico (≤ 91 %)
  reading('HEART_RATE', { value: p.hr + 14, at_rest: true }, 'wearable', 5.9);
  const typo = reading('BLOOD_PRESSURE', { systolic: 151, diastolic: 95 }, 'manual', 1.5);
  reading('BLOOD_PRESSURE', { systolic: p.bp[0] + 1, diastolic: p.bp[1] }, 'manual', 1.45, {
    supersedes_uuid: typo.client_uuid,
  });
  reading('BODY_TEMP', { value: p.temp }, 'manual', 1.4);
  reading('SPO2', { value: p.spo2 - 1 }, 'wearable', 1.3);
  add('wellbeing_checkin', ctx.nowMs - hour, {
    mood: p.wb.WB_MOOD,
    fatigue: p.wb.WB_FATIGUE,
    stress: p.wb.WB_STRESS,
    crew_conflict: p.wb.WB_CREW_CONFLICT,
    sleep_hours: round(p.sleep - 0.4, 1),
  });
  add('pvt_run', ctx.nowMs - 0.75 * hour, {
    device_id: OFFLINE_DEVICE,
    before_critical_task: false,
    duration_s: 180,
    trials: 52,
    lapses: p.pvt.lapses[1],
    mean_rt_ms: p.pvt.mean_rt[1],
    false_starts: p.pvt.false_starts[1],
  });
  items.push({ ...firstHr }); // el reintento de la app: mismo client_uuid y mismo payload

  return {
    items: [
      {
        type: 'sync_batch',
        call_sign: callSign,
        device_id: OFFLINE_DEVICE,
        measured_at: ctx.iso(ctx.nowMs),
        body: { device_id: OFFLINE_DEVICE, sent_at: ctx.iso(ctx.nowMs), items },
      },
    ],
    notes: [
      'Lote de ~24 h sin conexión por POST /sync/push: el SpO₂ crítico de hace 6 h se procesa primero y escala desde la recepción (late_sync).',
      'Trae un duplicado (reintento) y una corrección (supersedes_uuid). Repetirlo en el mismo minuto da todo duplicate.',
    ],
  };
}

/**
 * emergency_solar: el triaje de punta a punta.
 * 1. Evento solar en los dosímetros de toda la tripulación (dosis de evento moderada) y dos
 *    tripulantes con signos prodrómicos: VEGA y `astronaut` (LYRA) reportan náusea → crítico
 *    por síntomas (orau_ars) → activación automática por lectura crítica (pending).
 * 2. Nadie responde "estoy bien": el hombre muerto vence → activa, avisa a bordo y a Tierra.
 * 3. El comandante evalúa: VEGA responde (verde, vomitó entre 1 y 2 h → radiación probable),
 *    `astronaut` NO responde (rojo, solo signos observables del protocolo v2) y ATLAS (verde).
 *    La tableta manda su resultado (el mismo evaluador): coincide con el servidor.
 * 4. Corte de enlace: una pregunta fuera del protocolo y el cierre quedan en cola.
 * 5. Al cerrar el corte, el reporte sale hacia Tierra (llega tras el retraso de la misión).
 * Respuestas y curva: suposición de diseño para recorrer el protocolo.
 */
function emergencySolar(ctx, { crew, astronaut, radiation = {} }) {
  const unresponsive = astronaut;
  const names = crew.map((m) => m.call_sign);
  const conscious =
    names.includes('VEGA') && unresponsive !== 'VEGA'
      ? 'VEGA'
      : names.find((c) => c !== unresponsive && c !== 'ORION');
  const affected = [conscious, unresponsive].filter(Boolean);
  const profile = [10, 45, 75]; // dosis de evento moderada (precaución), cada 20 min
  const items = [];
  for (const { call_sign: callSign } of crew) {
    const factor = ctx.rng(callSign, 'factor').uniform(0.92, 1.08);
    const device = { device_id: `sim-dosimeter-${callSign.toLowerCase()}` };
    let eventDose = 0;
    profile.forEach((dose, i) => {
      const ms = ctx.nowMs - (profile.length - 1 - i) * 20 * MIN_MS;
      const last = i === profile.length - 1;
      const symptoms = last && affected.includes(callSign) ? ['nausea'] : [];
      const value = round(dose * factor, 2);
      eventDose += value;
      items.push(
        reading(
          ctx,
          callSign,
          'RAD_DOSE_DAILY',
          { value, event_active: true, symptoms },
          'sensor',
          ms,
          device,
        ),
      );
    });
    const base = radiation[callSign] ?? P.profileFor(callSign).rad_prior_msv;
    items.push(
      reading(
        ctx,
        callSign,
        'RAD_DOSE_CUM',
        { value: round(base + eventDose, 2) },
        'sensor',
        ctx.nowMs,
        device,
      ),
    );
  }
  const others = crew.map((m) => m.call_sign).filter((c) => !affected.includes(c) && c !== 'ORION');
  const assessments = [
    {
      call_sign: conscious,
      answers: {
        responsive_and_mobile: true,
        vomiting: true,
        time_to_vomiting: '1_2h',
        prodromal_symptoms: ['nausea', 'fatigue'],
      },
    },
    {
      call_sign: unresponsive,
      answers: {
        responsive_and_mobile: false,
        breathing: true,
        resp_rate_over_30: false,
        perfusion_ok: true,
        follows_commands: false,
        vomiting_observed: true,
        time_to_vomiting_observed: 'lt_1h',
        consciousness_level: 'pain',
      },
    },
    ...others.slice(0, 1).map((callSign) => ({
      call_sign: callSign,
      answers: { responsive_and_mobile: true, vomiting: false, prodromal_symptoms: ['none'] },
    })),
  ].filter((a) => a.call_sign);
  items.push({
    type: 'emergency_flow',
    call_sign: 'ORION',
    measured_at: ctx.iso(ctx.nowMs),
    affected,
    evaluator: 'ORION',
    assessments: assessments.map((a, i) => ({
      ...a,
      client_uuid: ctx.id('assessment', a.call_sign),
      sequence_no: i + 1,
    })),
    question: {
      client_uuid: ctx.id('question'),
      body: `Fuera del protocolo: ${conscious} pide algo para la náusea y ${unresponsive} sigue sin responder. ¿Qué indican?`,
    },
    close_notes: `${affected.join(' y ')} en el refugio; ${unresponsive} bajo observación del CMO.`,
  });
  return {
    items,
    notes: [
      'Activación automática por lectura crítica (náusea con evento solar) y hombre muerto vencido (el barrido se adelanta TRIAGE_DEADMAN_S).',
      `Evaluaciones del comandante: ${unresponsive} no responde (solo signos observables, protocolo v2).`,
      'Corte de enlace durante la pregunta a Tierra y el cierre: el reporte sale al cerrar el corte y llega tras el retraso de la misión.',
    ],
  };
}

const BUILDERS = {
  solar_event: solarEvent,
  crew_illness: crewIllness,
  co2_spike: co2Spike,
  wellbeing_decline: wellbeingDecline,
  offline_batch: offlineBatch,
  emergency_solar: emergencySolar,
};

/**
 * Arma el escenario. params ya validados (el servicio revisa que el astronauta sea de la
 * tripulación vigente y el módulo exista). Aplica los valores por defecto.
 */
function buildScenario(name, { now = new Date(), crew, ...input }) {
  if (!BUILDERS[name]) throw new Error(`Escenario desconocido: ${name}`);
  const params = {
    intensity: input.intensity || 'low',
    ...(DEFAULTS[name] || {}),
    ...Object.fromEntries(
      Object.entries({
        astronaut: input.astronaut,
        module_id: input.module_id,
        contagion: input.contagion,
      }).filter(([, v]) => v !== undefined && v !== null),
    ),
  };
  if (name !== 'crew_illness') delete params.contagion;
  if (name === 'crew_illness') params.contagion = Boolean(params.contagion);
  if (name !== 'co2_spike') delete params.module_id;
  const ctx = context({ name, now, params });
  const { items, notes } = BUILDERS[name](ctx, { crew, radiation: input.radiation, ...params });
  return {
    name,
    params,
    items: items.sort((a, b) => a.measured_at.localeCompare(b.measured_at)),
    notes,
  };
}

module.exports = { buildScenario, SCENARIOS, INTENSITIES, DEFAULTS, DECLINE_DAYS };
