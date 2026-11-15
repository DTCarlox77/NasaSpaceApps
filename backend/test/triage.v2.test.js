'use strict';
// Protocolo de triaje v2 (seed 004): si el tripulante no responde, el módulo de radiación
// solo pregunta signos observables. Se lee del seed para probar lo que se carga en la BD.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateAssessment } = require('../src/engine/triage');

function loadSeed(file) {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'seeds', file), 'utf8');
  const blocks = [...sql.matchAll(/\$json\$([\s\S]*?)\$json\$/g)].map((m) => JSON.parse(m[1]));
  return {
    definition: blocks.find((b) => b && !Array.isArray(b) && Array.isArray(b.questions)),
    sources: blocks.find(Array.isArray),
  };
}

const V2 = loadSeed('004_protocolo_triaje_v2.sql');
const V1 = loadSeed('001_demo_identidad_triaje.sql');
const run = (answers, context = { solar_event_active: true }) =>
  evaluateAssessment(V2.definition, { responder_safe: true, ...answers }, context);
const asked = (result) => result.path.map((step) => step.split('=')[0]);

// Preguntas que solo puede contestar el propio paciente (síntomas subjetivos).
const PATIENT_REPORTED = ['vomiting', 'time_to_vomiting', 'prodromal_symptoms'];
const OBSERVABLE = ['vomiting_observed', 'time_to_vomiting_observed', 'consciousness_level'];

test('v2: no obedece órdenes → rojo y solo signos observables (nunca síntomas)', () => {
  const r = run({
    responsive_and_mobile: false,
    breathing: true,
    resp_rate_over_30: false,
    perfusion_ok: true,
    follows_commands: false,
    vomiting_observed: true,
    time_to_vomiting_observed: 'lt_1h',
    consciousness_level: 'pain',
  });
  assert.equal(r.status, 'completed');
  assert.equal(r.triage_category, 'red');
  assert.equal(r.radiation_flag, 'probable');
  const steps = asked(r);
  for (const code of PATIENT_REPORTED) assert.equal(steps.includes(code), false, code);
  for (const code of OBSERVABLE) assert.ok(steps.includes(code), code);
});

test('v2: respira solo tras abrir la vía aérea → rojo sin preguntas al paciente', () => {
  const r = run({
    responsive_and_mobile: false,
    breathing: false,
    breathing_after_airway: true,
    vomiting_observed: false,
    consciousness_level: 'unresponsive',
  });
  assert.equal(r.triage_category, 'red');
  assert.equal(r.radiation_flag, 'none', 'sin vómito visto no se infiere radiación');
  assert.deepEqual(
    asked(r).filter((s) => PATIENT_REPORTED.includes(s)),
    [],
  );
  // Nadie vio la hora: no se pregunta el tiempo hasta el vómito.
  assert.equal(asked(r).includes('time_to_vomiting_observed'), false);
});

test('v2: un rojo que sí puede contestar responde sus síntomas como en la v1', () => {
  const r = run({
    responsive_and_mobile: false,
    breathing: true,
    resp_rate_over_30: true,
    can_self_report: true,
    vomiting: false,
    prodromal_symptoms: ['nausea'],
  });
  assert.equal(r.triage_category, 'red');
  assert.equal(r.radiation_flag, 'possible');
  assert.ok(asked(r).includes('prodromal_symptoms'));
  // Y si no puede contestar, solo lo observable.
  const silent = run({
    responsive_and_mobile: false,
    breathing: true,
    resp_rate_over_30: true,
    can_self_report: false,
    vomiting_observed: false,
    consciousness_level: 'voice',
  });
  assert.equal(silent.status, 'completed');
  assert.deepEqual(
    asked(silent).filter((s) => PATIENT_REPORTED.includes(s)),
    [],
  );
});

test('v2: falta una respuesta observable → incomplete con esa pregunta', () => {
  const r = run({
    responsive_and_mobile: false,
    breathing: true,
    resp_rate_over_30: false,
    perfusion_ok: true,
    follows_commands: false,
  });
  assert.equal(r.status, 'incomplete');
  assert.equal(r.pending, 'vomiting_observed');
});

test('v2: sin evento solar se omite el módulo de radiación', () => {
  const r = run(
    {
      responsive_and_mobile: false,
      breathing: true,
      resp_rate_over_30: false,
      perfusion_ok: true,
      follows_commands: false,
    },
    { solar_event_active: false },
  );
  assert.equal(r.status, 'completed');
  assert.equal(r.radiation_flag, 'none');
  assert.ok(r.path.includes('vomiting_observed:omitida'));
});

test('v2: mismas categorías que la v1 en START (sin evento solar)', () => {
  const cases = [
    { responsive_and_mobile: true },
    { responsive_and_mobile: false, breathing: false, breathing_after_airway: false },
    { responsive_and_mobile: false, breathing: false, breathing_after_airway: true },
    { responsive_and_mobile: false, breathing: true, resp_rate_over_30: true },
    {
      responsive_and_mobile: false,
      breathing: true,
      resp_rate_over_30: false,
      perfusion_ok: false,
    },
    {
      responsive_and_mobile: false,
      breathing: true,
      resp_rate_over_30: false,
      perfusion_ok: true,
      follows_commands: true,
    },
    {
      responsive_and_mobile: false,
      breathing: true,
      resp_rate_over_30: false,
      perfusion_ok: true,
      follows_commands: false,
    },
  ];
  const ctx = { solar_event_active: false };
  for (const answers of cases) {
    const all = { responder_safe: true, ...answers };
    const v1 = evaluateAssessment(V1.definition, all, ctx);
    const v2 = evaluateAssessment(V2.definition, all, ctx);
    assert.equal(v2.triage_category, v1.triage_category, JSON.stringify(answers));
    assert.deepEqual(v2.escalations, v1.escalations, JSON.stringify(answers));
  }
});

test('v2: cada pregunta y regla nueva cita una fuente del protocolo; lo propio es design_rule', () => {
  const ids = new Set(V2.sources.map((s) => s.id));
  for (const q of V2.definition.questions) assert.ok(ids.has(q.source), q.code);
  for (const r of V2.definition.radiation_flag_rules) assert.ok(ids.has(r.source));
  assert.ok(ids.has(V2.definition.attention_order.categories_source));
  assert.equal(V2.definition.attention_order.basis, 'design_rule');
  assert.equal(V2.definition.auto_activation.basis, 'design_rule');
  // La v1 no cambió: sigue sin estas preguntas.
  assert.equal(
    V1.definition.questions.some((q) => OBSERVABLE.includes(q.code)),
    false,
  );
});
