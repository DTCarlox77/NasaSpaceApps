'use strict';
// Pruebas de las reglas del catálogo con el evaluador. Ejecutar: node --test backend/test/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const catalog = require(path.join(__dirname, '..', 'docs', 'catalogo-indicadores.json'));
const { evaluateIndicator, evalCondition, fitnessFromPvt } = require('../src/engine/conditions');

const byCode = Object.fromEntries(catalog.indicators.map((i) => [i.code, i]));
const ev = (code, ctx) => evaluateIndicator(byCode[code], ctx);

// [código, contexto, nivel esperado, escalamiento esperado (opcional)]
const CASES = [
  // Presión arterial (AHA)
  ['BLOOD_PRESSURE', { systolic: 115, diastolic: 75 }, 'normal'],
  ['BLOOD_PRESSURE', { systolic: 125, diastolic: 78 }, 'caution', 'self_care'],
  ['BLOOD_PRESSURE', { systolic: 132, diastolic: 78 }, 'caution', 'self_care'],
  ['BLOOD_PRESSURE', { systolic: 118, diastolic: 85 }, 'caution', 'self_care'],
  ['BLOOD_PRESSURE', { systolic: 145, diastolic: 88 }, 'caution', 'flight_surgeon'],
  ['BLOOD_PRESSURE', { systolic: 185, diastolic: 100 }, 'critical', 'flight_surgeon'],
  ['BLOOD_PRESSURE', { systolic: 150, diastolic: 125, symptoms: ['chest_pain'] }, 'critical'],
  ['BLOOD_PRESSURE', { systolic: 88, diastolic: 58 }, 'caution', 'self_care'],
  ['BLOOD_PRESSURE', { systolic: 88, diastolic: 58, symptoms: ['dizziness'] }, 'critical'],
  // Frecuencia cardíaca
  ['HEART_RATE', { value: 72 }, 'normal'],
  ['HEART_RATE', { value: 150, at_rest: false }, 'unrated'],
  ['HEART_RATE', { value: 55 }, 'caution', 'self_care'],
  ['HEART_RATE', { value: 55, symptoms: ['fainting'] }, 'caution', 'crew'],
  ['HEART_RATE', { value: 105 }, 'caution', 'self_care'],
  ['HEART_RATE', { value: 120 }, 'caution', 'crew'],
  ['HEART_RATE', { value: 131 }, 'critical'],
  ['HEART_RATE', { value: 40 }, 'critical'],
  // Frecuencia respiratoria (NEWS2)
  ['RESP_RATE', { value: 16 }, 'normal'],
  ['RESP_RATE', { value: 10 }, 'caution', 'self_care'],
  ['RESP_RATE', { value: 22 }, 'caution', 'crew'],
  ['RESP_RATE', { value: 8 }, 'critical'],
  ['RESP_RATE', { value: 31 }, 'critical'],
  // SpO2 (OMS + NEWS2)
  ['SPO2', { value: 98 }, 'normal'],
  ['SPO2', { value: 95 }, 'normal'],
  ['SPO2', { value: 94 }, 'caution', 'self_care'],
  ['SPO2', { value: 92 }, 'caution', 'crew'],
  ['SPO2', { value: 89 }, 'critical'],
  // Temperatura
  ['BODY_TEMP', { value: 36.8 }, 'normal'],
  ['BODY_TEMP', { value: 36.0 }, 'caution', 'self_care'],
  ['BODY_TEMP', { value: 38.2 }, 'caution', 'crew'],
  ['BODY_TEMP', { value: 39.5 }, 'critical'],
  ['BODY_TEMP', { value: 34.8 }, 'critical'],
  // Glucosa (ADA)
  ['GLUCOSE', { value: 90, fasting: true }, 'normal'],
  ['GLUCOSE', { value: 110, fasting: true }, 'caution', 'self_care'],
  ['GLUCOSE', { value: 130, fasting: true }, 'caution', 'flight_surgeon'],
  ['GLUCOSE', { value: 150, fasting: false }, 'caution', 'self_care'],
  ['GLUCOSE', { value: 130, fasting: false }, 'normal'],
  ['GLUCOSE', { value: 65, fasting: true }, 'caution', 'self_care'],
  ['GLUCOSE', { value: 50, fasting: false }, 'critical'],
  ['GLUCOSE', { value: 62, fasting: false, symptoms: ['confusion'] }, 'critical'],
  ['GLUCOSE', { value: 220, fasting: false }, 'caution', 'flight_surgeon'],
  ['GLUCOSE', { value: 220, fasting: false, symptoms: ['excessive_thirst'] }, 'critical'],
  // Sueño
  ['SLEEP_HOURS', { value: 7.5, consecutive_nights_le_6h: 0 }, 'normal'],
  ['SLEEP_HOURS', { value: 6.5, consecutive_nights_le_6h: 0 }, 'caution', 'self_care'],
  ['SLEEP_HOURS', { value: 5.5, consecutive_nights_le_6h: 1 }, 'caution', 'self_care'],
  ['SLEEP_HOURS', { value: 5.8, consecutive_nights_le_6h: 3 }, 'caution', 'crew'],
  ['SLEEP_HOURS', { value: 6.0, consecutive_nights_le_6h: 7 }, 'critical'],
  // Radiación
  ['RAD_DOSE_DAILY', { value: 0.4, ratio_to_baseline: 1.1 }, 'normal'],
  ['RAD_DOSE_DAILY', { value: 1.0, ratio_to_baseline: 2.5 }, 'caution', 'crew'],
  ['RAD_DOSE_DAILY', { value: 60, ratio_to_baseline: 150, event_active: true, event_dose_msv: 130 }, 'caution', 'flight_surgeon'],
  ['RAD_DOSE_DAILY', { value: 90, event_active: true, event_dose_msv: 260 }, 'critical'],
  ['RAD_DOSE_DAILY', { value: 5, event_active: true, event_dose_msv: 20, symptoms: ['vomiting'] }, 'critical'],
  ['RAD_DOSE_CUM', { value: 120, pct_of_career_limit: 20, projected_end_msv: 210 }, 'normal'],
  ['RAD_DOSE_CUM', { value: 500, pct_of_career_limit: 83.3, projected_end_msv: 560 }, 'caution'],
  ['RAD_DOSE_CUM', { value: 450, pct_of_career_limit: 75, projected_end_msv: 640 }, 'caution'],
  ['RAD_DOSE_CUM', { value: 600, pct_of_career_limit: 100 }, 'critical'],
  // CO2
  ['HAB_CO2', { value: 2.0, avg_7d: 2.1, module_id: 'HAB-1' }, 'normal'],
  ['HAB_CO2', { value: 2.8, avg_7d: 2.6, module_id: 'HAB-1' }, 'caution', 'crew'],
  ['HAB_CO2', { value: 3.5, module_id: 'HAB-1' }, 'caution', 'crew'],
  ['HAB_CO2', { value: 5.0, module_id: 'HAB-1' }, 'caution', 'crew'],
  ['HAB_CO2', { value: 10.0, module_id: 'HAB-1' }, 'critical'],
  // Bienestar (confidencial)
  ['WB_MOOD', { value: 30, baseline_ready: false }, 'unrated'],
  ['WB_MOOD', { value: 60, baseline_ready: true, adverse_z_3d: 0.2, adverse_sustained_days: 0 }, 'normal'],
  ['WB_MOOD', { value: 20, baseline_ready: true, adverse_z_3d: 1.8, adverse_sustained_days: 3 }, 'caution', 'self_care'],
  ['WB_STRESS', { value: 90, baseline_ready: true, adverse_z_3d: 2.1, adverse_sustained_days: 5 }, 'caution', 'behavioral_health'],
  ['PHQ2_SCORE', { value: 2, item_1: 1, item_2: 1 }, 'normal'],
  ['PHQ2_SCORE', { value: 3, item_1: 2, item_2: 1 }, 'caution', 'behavioral_health'],
  ['GAD2_SCORE', { value: 4, item_1: 2, item_2: 2 }, 'caution', 'behavioral_health'],
  ['PVT_LAPSES', { value: 2, baseline_ready: false, device_id: 'TAB-1' }, 'unrated'],
  ['PVT_LAPSES', { value: 3, baseline_ready: true, z_device_baseline: 0.5, device_id: 'TAB-1' }, 'normal'],
  ['PVT_LAPSES', { value: 6, baseline_ready: true, z_device_baseline: 2.4, device_id: 'TAB-1' }, 'caution'],
  ['PVT_LAPSES', { value: 12, baseline_ready: false, device_id: 'TAB-1' }, 'caution'],
  ['PVT_LAPSES', { value: 22, baseline_ready: true, z_device_baseline: 5, device_id: 'TAB-1' }, 'critical', 'flight_surgeon'],
  ['PVT_MEAN_RT', { value: 290, baseline_ready: true, z_device_baseline: 2.2, device_id: 'TAB-1' }, 'caution'],
  ['PVT_FALSE_STARTS', { value: 1, baseline_ready: true, z_device_baseline: 0, device_id: 'TAB-1' }, 'normal'],
  // Resto
  ['BODY_MASS', { value: 74, pct_change_from_preflight: -2.5 }, 'normal'],
  ['BODY_MASS', { value: 70, pct_change_from_preflight: -6.0 }, 'caution', 'flight_surgeon'],
  ['BODY_MASS', { value: 66, pct_change_from_preflight: -11.0 }, 'critical'],
  ['EXERCISE_MIN', { value: 90, rolling_7d_pct_of_prescription: 100 }, 'normal'],
  ['EXERCISE_MIN', { value: 30, rolling_7d_pct_of_prescription: 70 }, 'caution', 'self_care'],
  ['EXERCISE_MIN', { value: 0, rolling_7d_pct_of_prescription: 40 }, 'caution', 'flight_surgeon'],
  ['VISION_CHECK', { near_blur: false, far_blur: false, amsler_distortion: false, blind_spot_or_field_loss: false, double_vision: false, transient_vision_loss: false, severe_headache: false }, 'normal'],
  ['VISION_CHECK', { near_blur: true, far_blur: false, amsler_distortion: false, blind_spot_or_field_loss: false, double_vision: false, transient_vision_loss: false, severe_headache: false }, 'caution'],
  ['VISION_CHECK', { near_blur: false, far_blur: false, amsler_distortion: true, blind_spot_or_field_loss: false, double_vision: false, transient_vision_loss: false, severe_headache: false }, 'critical'],
  ['SYMPTOM', { symptoms: [] }, 'normal'],
  ['SYMPTOM', { symptoms: ['headache'] }, 'caution', 'self_care'],
  ['SYMPTOM', { symptoms: ['cough', 'fever_feeling'] }, 'caution', 'crew'],
  ['SYMPTOM', { symptoms: ['fainting'] }, 'caution', 'crew'],
  ['SYMPTOM', { symptoms: ['headache', 'speech_difficulty'] }, 'critical'],
  ['HAB_TEMP', { value: 22, module_id: 'HAB-1' }, 'normal'],
  ['HAB_TEMP', { value: 26, module_id: 'HAB-1' }, 'caution', 'crew'],
  ['HAB_TEMP', { value: 28, module_id: 'HAB-1' }, 'critical'],
  ['HAB_HUMIDITY', { value: 45, module_id: 'HAB-1' }, 'normal'],
  ['HAB_HUMIDITY', { value: 65, module_id: 'HAB-1' }, 'caution'],
  ['HAB_HUMIDITY', { value: 80, module_id: 'HAB-1' }, 'critical'],
  ['HAB_NOISE', { value: 55, period: 'work', module_id: 'HAB-1' }, 'normal'],
  ['HAB_NOISE', { value: 52, period: 'sleep', module_id: 'HAB-1' }, 'caution', 'crew'],
  ['HAB_NOISE', { value: 62, period: 'work', module_id: 'HAB-1' }, 'caution', 'crew'],
  ['HAB_NOISE', { value: 86, period: 'work', module_id: 'HAB-1' }, 'critical'],
];

for (const [code, ctx, level, escalation] of CASES) {
  test(`${code} ${JSON.stringify(ctx)} -> ${level}${escalation ? `/${escalation}` : ''}`, () => {
    assert.ok(byCode[code], `indicador ${code} no está en el catálogo`);
    const r = ev(code, ctx);
    assert.equal(r.level, level);
    if (escalation) assert.equal(r.escalation, escalation);
  });
}

test('operadores: between, in, grupos anidados y campo ausente', () => {
  assert.equal(evalCondition({ field: 'v', op: 'between', value: [1, 3] }, { v: 3 }), true);
  assert.equal(evalCondition({ field: 'v', op: 'in', value: ['a', 'b'] }, { v: 'b' }), true);
  assert.equal(evalCondition({ field: 'x', op: 'gt', value: 1 }, {}), false);
  assert.equal(evalCondition({ all: [] }, {}), true);
  assert.equal(evalCondition({ any: [{ all: [{ field: 'a', op: 'eq', value: 1 }] }, { field: 'b', op: 'lt', value: 0 }] }, { a: 1 }), true);
  assert.throws(() => evalCondition({ field: 'a', op: 'regex', value: 'x' }, { a: 1 }));
});

test('aptitud PVT: cualquier indicador no normal => not_confirmed', () => {
  assert.equal(fitnessFromPvt([{ level: 'normal' }, { level: 'normal' }]), 'fit');
  assert.equal(fitnessFromPvt([{ level: 'normal' }, { level: 'unrated' }]), 'not_confirmed');
});

test('ningún indicador confidencial escala a la tripulación', () => {
  for (const ind of catalog.indicators.filter((i) => i.sensitivity === 'confidential')) {
    for (const r of ind.rules) assert.notEqual(r.escalation, 'crew', ind.code);
  }
});

test('cada regla cita al menos una fuente que existe en el indicador', () => {
  for (const ind of catalog.indicators) {
    const ids = new Set(ind.sources.map((s) => s.id));
    for (const r of ind.rules) {
      assert.ok(r.source_ids.length > 0, ind.code);
      for (const s of r.source_ids) assert.ok(ids.has(s), `${ind.code}: ${s}`);
    }
  }
});
