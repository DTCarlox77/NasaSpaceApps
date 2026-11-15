'use strict';
// Simulador (tarea 7), parte pura: determinismo, client_uuid, rangos de la historia normal y
// forma de cada escenario. Sin base de datos.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const catalog = require('../docs/catalogo-indicadores.json');
const { evaluateIndicator } = require('../src/engine/conditions');
const { isUuid } = require('../src/utils/validate');
const { generateHistory } = require('../src/simulator/history');
const { buildScenario, SCENARIOS } = require('../src/simulator/scenarios');
const { rngFor, uuidFor } = require('../src/simulator/random');
const { profileFor } = require('../src/simulator/profiles');

const NOW = new Date('2026-11-14T15:20:30Z');
const MISSION_START = new Date('2026-09-30T12:00:00Z');
const CREW = ['ATLAS', 'LYRA', 'ORION', 'VEGA'].map((call_sign) => ({ call_sign }));
const INDICATORS = new Map(catalog.indicators.map((i) => [i.code, i]));

const history = (seed = 42, extra = {}) =>
  generateHistory({
    seed,
    days: 14,
    now: NOW,
    missionStartsAt: MISSION_START,
    crew: CREW,
    ...extra,
  });

/** Evalúa con las reglas del catálogo, sin derivados (las reglas con derivados no aplican). */
function evaluate(code, values) {
  const indicator = INDICATORS.get(code);
  return evaluateIndicator({ code, rules: indicator.rules, rules_version: 1 }, values);
}

const valuesOf = (item) =>
  item.type === 'habitat'
    ? {
        value: item.value,
        module_id: item.module_id,
        ...(item.period ? { period: item.period } : {}),
      }
    : item.values;

test('rngFor: misma clave → misma secuencia; otra clave → otra', () => {
  const a = rngFor(42, 'ORION', 'HEART_RATE', '2026-11-14');
  const b = rngFor(42, 'ORION', 'HEART_RATE', '2026-11-14');
  const c = rngFor(43, 'ORION', 'HEART_RATE', '2026-11-14');
  const seqA = [a(), a(), a()];
  assert.deepEqual(seqA, [b(), b(), b()]);
  assert.notDeepEqual(seqA, [c(), c(), c()]);
  for (const x of seqA) assert.ok(x >= 0 && x < 1);
});

test('uuidFor: determinista, formato UUID válido (versión 8) y sin choques', () => {
  assert.equal(uuidFor('a', 1), uuidFor('a', 1));
  assert.notEqual(uuidFor('a', 1), uuidFor('a', 2));
  const id = uuidFor('x');
  assert.ok(isUuid(id));
  assert.equal(id[14], '8');
  assert.ok('89ab'.includes(id[19]));
});

test('historia: misma semilla → mismos datos; otra semilla → otros valores, misma forma', () => {
  const a = history(42);
  assert.deepEqual(history(42), a);
  const b = history(7);
  assert.equal(b.items.length, a.items.length);
  assert.notDeepEqual(
    b.items.map((i) => i.values || i.value),
    a.items.map((i) => i.values || i.value),
  );
  assert.notEqual(b.items[0].client_uuid, a.items[0].client_uuid);
});

test('historia: un día ya generado da los mismos client_uuid aunque se corra más tarde', () => {
  const morning = history(42);
  const later = history(42, { now: new Date('2026-11-14T22:00:00Z') });
  const ids = new Set(later.items.map((i) => i.client_uuid));
  for (const item of morning.items) assert.ok(ids.has(item.client_uuid), item.client_uuid);
  assert.ok(later.items.length > morning.items.length);
});

test('historia: contenido, fechas y client_uuid únicos', () => {
  const { items, from, to } = history();
  assert.equal(from, '2026-11-01T00:00:00.000Z');
  assert.equal(to, NOW.toISOString());
  const ids = new Set(items.map((i) => i.client_uuid));
  assert.equal(ids.size, items.length);
  for (const item of items) {
    assert.ok(item.measured_at <= NOW.toISOString(), 'nada en el futuro');
    assert.ok(item.measured_at >= MISSION_START.toISOString(), 'nada antes de la misión');
  }
  const codes = new Set(items.filter((i) => i.indicator_code).map((i) => i.indicator_code));
  for (const code of [
    'BLOOD_PRESSURE',
    'HEART_RATE',
    'RESP_RATE',
    'SPO2',
    'BODY_TEMP',
    'GLUCOSE',
    'BODY_MASS',
    'EXERCISE_MIN',
    'RAD_DOSE_DAILY',
    'RAD_DOSE_CUM',
    'HAB_CO2',
    'HAB_TEMP',
    'HAB_HUMIDITY',
    'HAB_NOISE',
    'PHQ2_SCORE',
    'GAD2_SCORE',
  ]) {
    assert.ok(codes.has(code), code);
  }
  const count = (type) => items.filter((i) => i.type === type).length;
  assert.equal(
    count('checkin'),
    14 * 4,
    'un check-in diario por astronauta (hoy ya pasó las 07:00)',
  );
  // 3 corridas de línea base + 2 semanales por astronauta en 14 días.
  assert.equal(count('pvt'), 4 * 3 + 4 * 2);
  // Hábitat: 2 módulos × 4 indicadores por hora. Hoy hasta las 15:20: HAB-1 (hh:05) ya midió
  // a las 15 h; HAB-2 (hh:35) todavía no.
  assert.equal(count('habitat'), 2 * 4 * (13 * 24 + 15) + 4);
  const noise = items.filter((i) => i.indicator_code === 'HAB_NOISE');
  assert.ok(noise.some((i) => i.period === 'sleep') && noise.some((i) => i.period === 'work'));
});

test('historia: con la misión recién empezada no genera nada antes del inicio', () => {
  const start = new Date('2026-11-12T10:00:00Z');
  const { items, from } = generateHistory({
    seed: 1,
    days: 14,
    now: NOW,
    missionStartsAt: start,
    crew: CREW,
  });
  assert.equal(from, start.toISOString());
  assert.ok(items.every((i) => i.measured_at >= start.toISOString()));
});

test('historia normal: ningún crítico ni escalamiento por valor (reglas del catálogo)', () => {
  const levels = {};
  for (const item of history().items) {
    if (item.type !== 'reading' && item.type !== 'habitat') continue;
    const result = evaluate(item.indicator_code, valuesOf(item));
    assert.notEqual(result.level, 'critical', `${item.indicator_code} ${JSON.stringify(item)}`);
    assert.equal(result.escalation, 'self_care', `${item.indicator_code} ${JSON.stringify(item)}`);
    levels[result.level] = (levels[result.level] || 0) + 1;
  }
  assert.ok(levels.caution > 0, 'hay alguna precaución ocasional (de autocuidado)');
});

test('historia: radiación diaria en 0.2–0.5 mSv y acumulada creciente', () => {
  const { items } = history();
  const orion = items.filter((i) => i.call_sign === 'ORION');
  const daily = orion
    .filter((i) => i.indicator_code === 'RAD_DOSE_DAILY')
    .map((i) => i.values.value);
  assert.ok(daily.every((v) => v >= 0.2 && v <= 0.5));
  const cum = orion.filter((i) => i.indicator_code === 'RAD_DOSE_CUM').map((i) => i.values.value);
  for (let k = 1; k < cum.length; k += 1) assert.ok(cum[k] > cum[k - 1]);
});

test('escenarios: valores por defecto y validación de nombre', () => {
  assert.deepEqual(SCENARIOS, [
    'solar_event',
    'crew_illness',
    'co2_spike',
    'wellbeing_decline',
    'offline_batch',
  ]);
  assert.deepEqual(buildScenario('crew_illness', { now: NOW, crew: CREW }).params, {
    intensity: 'low',
    astronaut: 'LYRA',
    contagion: false,
  });
  assert.deepEqual(buildScenario('co2_spike', { now: NOW, crew: CREW }).params, {
    intensity: 'low',
    module_id: 'HAB-1',
  });
  assert.deepEqual(buildScenario('wellbeing_decline', { now: NOW, crew: CREW }).params, {
    intensity: 'low',
    astronaut: 'ATLAS',
  });
  assert.throws(() => buildScenario('meteor', { now: NOW, crew: CREW }));
});

test('escenarios: mismo minuto → mismos client_uuid; otro minuto → episodio nuevo', () => {
  const ids = (now) =>
    buildScenario('co2_spike', { now, crew: CREW }).items.map((i) => i.client_uuid);
  assert.deepEqual(ids(new Date('2026-11-14T15:20:05Z')), ids(new Date('2026-11-14T15:20:55Z')));
  assert.notDeepEqual(ids(new Date('2026-11-14T15:20:05Z')), ids(new Date('2026-11-14T15:21:05Z')));
  for (const item of buildScenario('co2_spike', { now: NOW, crew: CREW }).items) {
    assert.ok(item.measured_at <= NOW.toISOString());
  }
});

test('co2_spike: low pasa de 4.5 sin llegar a 10; high llega a 10', () => {
  const peak = (intensity) =>
    Math.max(
      ...buildScenario('co2_spike', { now: NOW, crew: CREW, intensity }).items.map((i) => i.value),
    );
  assert.ok(peak('low') > 4.5 && peak('low') < 10);
  assert.ok(peak('high') >= 10);
  const low = buildScenario('co2_spike', { now: NOW, crew: CREW, module_id: 'HAB-2' });
  assert.ok(low.items.every((i) => i.module_id === 'HAB-2'));
  assert.ok(low.items.some((i) => i.value > 3 && i.value <= 4.5));
});

test('solar_event: dosis del evento ≥ 125 (low) y ≥ 250 (high); náusea solo en el elegido', () => {
  const eventDose = (intensity, callSign) =>
    buildScenario('solar_event', { now: NOW, crew: CREW, intensity })
      .items.filter((i) => i.call_sign === callSign && i.indicator_code === 'RAD_DOSE_DAILY')
      .reduce((s, i) => s + i.values.value, 0);
  for (const { call_sign: cs } of CREW) {
    assert.ok(eventDose('low', cs) >= 125 && eventDose('low', cs) < 250, cs);
    assert.ok(eventDose('high', cs) >= 250, cs);
  }
  const withNausea = buildScenario('solar_event', { now: NOW, crew: CREW, astronaut: 'VEGA' });
  const daily = withNausea.items.filter((i) => i.indicator_code === 'RAD_DOSE_DAILY');
  const nausea = daily.filter((i) => i.values.symptoms.includes('nausea'));
  assert.deepEqual(
    nausea.map((i) => i.call_sign),
    ['VEGA'],
  );
  assert.ok(daily.every((i) => i.values.event_active === true));
});

test('solar_event: RAD_DOSE_CUM al final = acumulada previa + dosis del evento', () => {
  const scenario = buildScenario('solar_event', {
    now: NOW,
    crew: CREW,
    radiation: { ORION: 100 },
  });
  for (const { call_sign: cs } of CREW) {
    const mine = scenario.items.filter((i) => i.call_sign === cs);
    const cum = mine.filter((i) => i.indicator_code === 'RAD_DOSE_CUM');
    assert.equal(cum.length, 1, cs);
    assert.equal(mine[mine.length - 1], cum[0], `${cs}: la acumulada va después del pico`);
    const event = mine
      .filter((i) => i.indicator_code === 'RAD_DOSE_DAILY')
      .reduce((s, i) => s + i.values.value, 0);
    // Sin dato de la base, parte de la dosis de carrera previa del perfil.
    const base = cs === 'ORION' ? 100 : profileFor(cs).rad_prior_msv;
    assert.ok(Math.abs(cum[0].values.value - (base + event)) < 0.011, cs);
  }
});

test('crew_illness: fiebre ≥ 38 (crítica en high) y contagio a un segundo tripulante', () => {
  const temps = (s) => s.items.filter((i) => i.indicator_code === 'BODY_TEMP');
  const low = buildScenario('crew_illness', { now: NOW, crew: CREW });
  assert.equal(evaluate('BODY_TEMP', temps(low)[0].values).level, 'caution');
  assert.equal(evaluate('BODY_TEMP', temps(low)[0].values).escalation, 'crew');
  const high = buildScenario('crew_illness', { now: NOW, crew: CREW, intensity: 'high' });
  assert.equal(evaluate('BODY_TEMP', temps(high)[0].values).level, 'critical');
  const spread = buildScenario('crew_illness', { now: NOW, crew: CREW, contagion: true });
  const sick = new Set(temps(spread).map((i) => i.call_sign));
  assert.equal(sick.size, 2);
  assert.ok(temps(spread).every((i) => i.values.value >= 38));
  assert.ok(
    temps(spread).some((i) => i.measured_at < '2026-11-14T00:00:00Z'),
    'el primero, ayer',
  );
});

test('wellbeing_decline: 5 días seguidos claramente peores; en high, PHQ-2 y GAD-2 ≥ 3', () => {
  const low = buildScenario('wellbeing_decline', { now: NOW, crew: CREW });
  const days = low.items.filter((i) => i.type === 'wellbeing_day');
  assert.deepEqual(
    days.map((d) => d.date),
    ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'],
  );
  for (const d of days) {
    assert.ok(d.sliders.WB_MOOD.value <= 68 - 30);
    assert.ok(d.sliders.WB_STRESS.value >= 30 + 30);
  }
  assert.equal(low.items.filter((i) => i.type === 'instrument').length, 0);
  const high = buildScenario('wellbeing_decline', { now: NOW, crew: CREW, intensity: 'high' });
  const scores = high.items
    .filter((i) => i.type === 'instrument')
    .map((i) => i.answers.item_1 + i.answers.item_2);
  assert.ok(scores.length === 2 && scores.every((s) => s >= 3));
});
