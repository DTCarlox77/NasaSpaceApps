'use strict';
// Campos derivados del semáforo (src/engine/derived.js). Puras: sin base de datos.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const d = require('../src/engine/derived');
const { evaluateIndicator } = require('../src/engine/conditions');

const catalog = require(path.join(__dirname, '..', 'docs', 'catalogo-indicadores.json'));
const byCode = Object.fromEntries(catalog.indicators.map((i) => [i.code, i]));

// Día n de una misión de ejemplo, a las 07:00 UTC.
const day = (n, hour = 7) => new Date(Date.UTC(2026, 10, 1 + n, hour)).toISOString();
const r = (n, components, extra = {}) => ({ components, measured_at: day(n), ...extra });
const v = (n, value, extra = {}) => r(n, { value, ...extra });

// Evalúa como lo hace el servidor: componentes + derivados contra las reglas del catálogo.
const evaluate = (code, reading, ctx) =>
  evaluateIndicator(byCode[code], {
    ...reading.components,
    ...d.computeDerived(byCode[code], reading, ctx),
  });

test('consecutive_nights_le_6h: cuenta noches seguidas ≤ 6 h incluida la actual', () => {
  const history = [v(1, 5.5), v(2, 6), v(3, 5.8), v(4, 6), v(5, 5.9), v(6, 6)];
  assert.equal(d.consecutiveNightsLe6h(v(7, 5.5), history), 7);
  assert.equal(d.consecutiveNightsLe6h(v(7, 7.5), history), 0, 'la noche actual > 6 h → 0');
  assert.equal(d.consecutiveNightsLe6h(v(7, 5.5), []), 1, 'sin historial cuenta solo la actual');
  // Una noche sin registro o con > 6 h corta la racha.
  assert.equal(
    d.consecutiveNightsLe6h(v(7, 5.5), [v(1, 5), v(2, 5), v(4, 5), v(5, 5), v(6, 5)]),
    4,
  );
  assert.equal(d.consecutiveNightsLe6h(v(7, 5.5), [v(5, 8), v(6, 5)]), 2);
  // Varias lecturas el mismo día: manda la más reciente.
  assert.equal(
    d.consecutiveNightsLe6h(v(7, 5), [
      r(6, { value: 9 }),
      { components: { value: 5 }, measured_at: day(6, 20) },
    ]),
    2,
  );
  assert.equal(evaluate('SLEEP_HOURS', v(7, 5.5), { history }).level, 'critical');
});

test('ratio_to_baseline: mediana de 7 días sin días de evento', () => {
  const history = [
    v(1, 0.3),
    v(2, 0.5),
    v(3, 0.4),
    v(4, 5, { event_active: true }),
    v(5, 0.4),
    v(6, 0.6),
  ];
  assert.equal(d.ratioToBaseline(v(7, 1.0), history), 1.0 / 0.4);
  assert.equal(
    d.ratioToBaseline(v(7, 1.0), [v(-5, 0.4)]),
    undefined,
    'fuera de la ventana de 7 días',
  );
  assert.equal(d.ratioToBaseline(v(7, 1.0), []), undefined, 'sin historial → se omite');
  assert.equal(d.ratioToBaseline(v(7, 1.0), [v(6, 0)]), undefined, 'mediana 0 → se omite');
  assert.equal(evaluate('RAD_DOSE_DAILY', v(7, 1.0), { history }).level, 'caution');
});

test('event_dose_msv: suma desde que empezó la racha con event_active', () => {
  const history = [v(4, 0.4), v(5, 60, { event_active: true }), v(6, 70, { event_active: true })];
  assert.equal(d.eventDoseMsv(v(7, 30, { event_active: true }), history), 160);
  assert.equal(d.eventDoseMsv(v(7, 0.4), history), undefined, 'sin evento → se omite');
  assert.equal(d.eventDoseMsv(v(7, 30, { event_active: true }), []), 30, 'empieza la racha');
  assert.equal(
    evaluate('RAD_DOSE_DAILY', v(7, 130, { event_active: true }), { history }).level,
    'critical',
    '260 mSv acumulados en el evento',
  );
});

test('pct_of_career_limit y projected_end_msv', () => {
  assert.equal(d.pctOfCareerLimit(v(7, 450)), 75);
  const doses = [v(1, 1), v(2, 1), v(3, 2), v(4, 2), v(5, 2), v(6, 2)];
  const endsAt = day(102); // 95 días después
  assert.equal(d.projectedEndMsv(v(7, 450), doses, endsAt), 450 + 2 * 95);
  assert.equal(d.projectedEndMsv(v(7, 450), doses, null), undefined, 'sin fecha de fin → se omite');
  assert.equal(d.projectedEndMsv(v(7, 450), [], endsAt), undefined, 'sin dosis diarias → se omite');
  assert.equal(d.projectedEndMsv(v(7, 450), doses, day(3)), 450, 'misión ya terminada: 0 días');
  const res = evaluate('RAD_DOSE_CUM', v(7, 450), { dailyDoses: doses, missionEndsAt: endsAt });
  assert.equal(res.level, 'caution', 'proyección 640 mSv ≥ 600');
  const noEnd = evaluate('RAD_DOSE_CUM', v(7, 450), { dailyDoses: doses, missionEndsAt: null });
  assert.equal(noEnd.level, 'normal', 'sin fin de misión la regla de proyección no aplica');
});

test('avg_7d: promedio de 7 días del módulo, incluida la actual', () => {
  const history = [v(1, 2.4), v(3, 2.6), v(5, 2.8)];
  assert.equal(d.avg7d(v(7, 2.6), history), (2.4 + 2.6 + 2.8 + 2.6) / 4);
  assert.equal(d.avg7d(v(7, 2.6), [v(-3, 9)]), undefined, 'solo lecturas viejas → se omite');
  assert.equal(d.avg7d(v(7, 2.6), []), undefined, 'una sola lectura no es un promedio de 7 días');
  assert.equal(
    evaluate('HAB_CO2', v(7, 2.6, { module_id: 'HAB-1' }), { history }).level,
    'caution',
  );
  assert.equal(
    evaluate('HAB_CO2', v(7, 2.6, { module_id: 'HAB-1' }), { history: [] }).level,
    'normal',
  );
});

test('pct_change_from_preflight: contra la primera lectura de la misión', () => {
  const baseline = v(0, 74);
  assert.ok(Math.abs(d.pctChangeFromPreflight(v(30, 69.56), baseline) - -6) < 1e-9);
  assert.equal(d.pctChangeFromPreflight(v(30, 70), null), undefined, 'es la primera → se omite');
  assert.equal(
    d.pctChangeFromPreflight(v(0, 70), v(5, 74)),
    undefined,
    'la base no puede ser posterior',
  );
  assert.equal(evaluate('BODY_MASS', v(30, 69.56), { baseline }).level, 'caution');
  assert.equal(evaluate('BODY_MASS', v(30, 66), { baseline }).level, 'critical');
});

test('rolling_7d_pct_of_prescription: minutos de 7 días / prescripción', () => {
  const history = [v(0, 90), v(1, 90), v(2, 0), v(3, 30), v(4, 60), v(5, 60), v(6, 30)];
  // Ventana [día 0, día 7): días 0–6 = 360 min + 0 de hoy = 360 / 600 = 60 %.
  assert.equal(d.rolling7dPctOfPrescription(v(7, 0), history, 600), 60);
  assert.equal(
    d.rolling7dPctOfPrescription(v(7, 0), [v(5, 60), v(6, 30)], 600),
    undefined,
    'historial de < 6 días → se omite',
  );
  assert.equal(d.rolling7dPctOfPrescription(v(7, 0), history, 0), undefined);
  assert.equal(
    evaluate('EXERCISE_MIN', v(7, 0), { history, weeklyPrescriptionMin: 600 }).escalation,
    'self_care',
  );
  assert.equal(
    evaluate('EXERCISE_MIN', v(7, 0), { history, weeklyPrescriptionMin: 1000 }).escalation,
    'flight_surgeon',
  );
});

test('bienestar: línea base, adverse_z_3d (orientado) y días sostenidos', () => {
  // 8 check-ins de línea base (días 0–7) alrededor de 70 y 5 recientes muy bajos.
  const base = [68, 72, 70, 69, 71, 70, 72, 68].map((x, i) => v(i, x));
  const low = [20, 22, 18, 21].map((x, i) => v(8 + i, x));
  const mood = d.wellbeingDerived(v(12, 19), [...base, ...low], 'high');
  assert.equal(mood.baseline_ready, true);
  assert.ok(mood.adverse_z_3d > 1.5, 'ánimo bajo = peor (signo invertido)');
  assert.ok(mood.adverse_sustained_days >= 3);
  const stress = d.wellbeingDerived(v(12, 19), [...base, ...low], 'low');
  assert.ok(stress.adverse_z_3d < 0, 'en estrés, bajo = mejor');

  const notReady = d.wellbeingDerived(v(3, 50), [v(0, 50), v(1, 55), v(2, 52)], 'high');
  assert.deepEqual(notReady, { baseline_ready: false }, 'sin línea base solo baseline_ready');
  assert.equal(
    evaluate('WB_MOOD', v(3, 50), { history: [v(0, 50), v(1, 55), v(2, 52)] }).level,
    'unrated',
  );
  const sustained = evaluate('WB_MOOD', v(12, 19), { history: [...base, ...low] });
  assert.notEqual(sustained.level, 'normal');
});

test('PVT: línea base del mismo dispositivo y en descanso', () => {
  const runs = [3, 4, 3, 2].map((x, i) => r(i, { value: x, device_id: 'TAB-1' }, { rest: true }));
  const other = [
    r(1, { value: 30, device_id: 'TAB-2' }, { rest: true }),
    r(2, { value: 30, device_id: 'TAB-1' }, { rest: false }),
  ];
  const out = d.pvtDerived(r(5, { value: 8, device_id: 'TAB-1' }), [...runs, ...other]);
  assert.equal(out.baseline_ready, true);
  assert.ok(out.z_device_baseline > 2, 'otro dispositivo o sin descanso no cuentan');
  assert.deepEqual(d.pvtDerived(r(5, { value: 8, device_id: 'TAB-1' }), runs.slice(0, 2)), {
    baseline_ready: false,
  });
  assert.equal(d.pvtDerived(r(5, { value: 8, device_id: 'TAB-3' }), runs).baseline_ready, false);
  assert.equal(
    evaluate('PVT_LAPSES', r(5, { value: 8, device_id: 'TAB-1' }), { history: runs }).level,
    'caution',
  );
});

test('computeDerived omite lo que no puede calcular e ignora indicadores sin derivados', () => {
  assert.deepEqual(d.computeDerived(byCode.HAB_CO2, v(7, 2), { history: [] }), {});
  assert.deepEqual(d.computeDerived(byCode.BODY_MASS, v(7, 70), {}), {});
  assert.deepEqual(d.computeDerived(byCode.RAD_DOSE_CUM, v(7, 300), {}), {
    pct_of_career_limit: 50,
  });
  assert.deepEqual(d.computeDerived(byCode.SPO2, v(7, 97), {}), {});
  assert.deepEqual(d.computeDerived(byCode.SLEEP_HOURS, r(7, {}), {}), {}, 'sin value');
});
