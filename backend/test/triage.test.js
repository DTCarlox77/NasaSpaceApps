'use strict';
// Pruebas del motor de triaje con el protocolo real del seed. Ejecutar: node --test (desde backend/)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateAssessment, testCondition } = require('../src/engine/triage');

// El protocolo se lee del seed (solo lectura) para probar exactamente lo que se carga en la BD.
function loadSeedProtocol() {
  const file = path.join(__dirname, '..', 'db', 'seeds', '001_demo_identidad_triaje.sql');
  const sql = fs.readFileSync(file, 'utf8');
  const blocks = [...sql.matchAll(/\$json\$([\s\S]*?)\$json\$/g)].map((m) => JSON.parse(m[1]));
  const definition = blocks.find((b) => b && !Array.isArray(b) && Array.isArray(b.questions));
  assert.ok(definition, 'no se encontró la definición del protocolo en el seed');
  return definition;
}

const PROTOCOL = loadSeedProtocol();
const run = (answers, context = {}) => evaluateAssessment(PROTOCOL, answers, context);
const actions = (r) => r.escalations.map((e) => `${e.level}:${e.priority}`);
const scope = (answers = {}, context = {}, fields = {}) => ({ answers, context, fields });

const SAFE = { responder_safe: true };
const SOLAR = { solar_event_active: true };
const NO_SOLAR = { solar_event_active: false };
const EMERGENCY = ['crew:emergency', 'flight_surgeon:emergency'];
const URGENT = ['crew:urgent', 'flight_surgeon:urgent'];
const ROUTINE = ['self_care:routine', 'crew:routine'];

// ---------------------------------------------------------------------------
// Comportamiento actual que se conserva
// ---------------------------------------------------------------------------

test('1 · eq en ramas booleanas: responde y se desplaza => verde, rutina', () => {
  const r = run({ ...SAFE, responsive_and_mobile: true }, NO_SOLAR);
  assert.equal(r.status, 'completed');
  assert.equal(r.triage_category, 'green');
  assert.equal(r.radiation_flag, 'none');
  assert.deepEqual(actions(r), ROUTINE);
});

test('1 · eq en ramas booleanas: recorrido completo hasta amarillo', () => {
  const r = run({
    ...SAFE,
    responsive_and_mobile: false,
    breathing: true,
    resp_rate_over_30: false,
    perfusion_ok: true,
    follows_commands: true,
  });
  assert.equal(r.triage_category, 'yellow');
  assert.deepEqual(actions(r), URGENT);
});

test('2 · in: rojo y negro escalan como emergencia', () => {
  const red = run({
    ...SAFE,
    responsive_and_mobile: false,
    breathing: false,
    breathing_after_airway: true,
  });
  assert.equal(red.triage_category, 'red');
  assert.deepEqual(actions(red), EMERGENCY);

  const black = run({
    ...SAFE,
    responsive_and_mobile: false,
    breathing: false,
    breathing_after_airway: false,
  });
  assert.equal(black.triage_category, 'black');
  assert.deepEqual(actions(black), EMERGENCY);
});

test('3 · has_any: síntomas prodrómicos => radiación posible, urgente', () => {
  const r = run(
    {
      ...SAFE,
      responsive_and_mobile: true,
      vomiting: false,
      prodromal_symptoms: ['fatigue', 'headache'],
    },
    SOLAR,
  );
  assert.equal(r.triage_category, 'green');
  assert.equal(r.radiation_flag, 'possible');
  assert.deepEqual(actions(r), URGENT);

  const none = run(
    { ...SAFE, responsive_and_mobile: true, vomiting: false, prodromal_symptoms: ['none'] },
    SOLAR,
  );
  assert.equal(none.radiation_flag, 'none');
  assert.deepEqual(actions(none), ROUTINE);
});

test('4 · grupos any/all anidados con q, ctx y field', () => {
  const cond = {
    all: [
      {
        any: [
          { q: 'vomiting', op: 'eq', value: true },
          { ctx: 'environment_alarm', op: 'eq', value: 'co2' },
        ],
      },
      { field: 'category', op: 'in', value: ['red', 'yellow'] },
    ],
  };
  assert.equal(testCondition(cond, scope({ vomiting: true }, {}, { category: 'red' })), true);
  assert.equal(
    testCondition(cond, scope({}, { environment_alarm: 'co2' }, { category: 'yellow' })),
    true,
  );
  assert.equal(testCondition(cond, scope({ vomiting: false }, {}, { category: 'red' })), false);
  assert.equal(testCondition(cond, scope({ vomiting: true }, {}, { category: 'green' })), false);
});

test('5 · campo ausente = falso', () => {
  const s = scope({}, {}, {});
  assert.equal(testCondition({ q: 'vomiting', op: 'eq', value: true }, s), false);
  assert.equal(testCondition({ ctx: 'solar_event_active', op: 'eq', value: true }, s), false);
  assert.equal(testCondition({ field: 'category', op: 'in', value: ['red'] }, s), false);
  assert.equal(
    testCondition({ q: 'prodromal_symptoms', op: 'has_any', value: ['nausea'] }, s),
    false,
  );

  // Sin solar_event_active en el contexto, el módulo de radiación se omite.
  const r = run({ ...SAFE, responsive_and_mobile: true }, {});
  assert.equal(r.status, 'completed');
  assert.ok(r.path.includes('vomiting:omitida'));
});

test('5 · condición nula = verdadera', () => {
  assert.equal(testCondition(null, scope()), true);
  assert.equal(testCondition(undefined, scope()), true);
  assert.equal(testCondition({ all: [null] }, scope()), true);
});

test('6 · incomplete con la pregunta pendiente', () => {
  const a = run(SAFE);
  assert.equal(a.status, 'incomplete');
  assert.equal(a.pending, 'responsive_and_mobile');

  const b = run({ ...SAFE, responsive_and_mobile: false, breathing: true });
  assert.equal(b.status, 'incomplete');
  assert.equal(b.pending, 'resp_rate_over_30');

  // Con categoría ya decidida y módulo de radiación activo, falta 'vomiting'.
  const c = run({ ...SAFE, responsive_and_mobile: true }, SOLAR);
  assert.equal(c.status, 'incomplete');
  assert.equal(c.pending, 'vomiting');
  assert.equal(c.triage_category, 'green');
});

test('6 · gana la primera regla que se cumple', () => {
  // Rojo + radiación posible: cumple las reglas 1 y 2 de escalamiento; gana la 1.
  const r = run(
    {
      ...SAFE,
      responsive_and_mobile: false,
      breathing: false,
      breathing_after_airway: true,
      vomiting: false,
      prodromal_symptoms: ['fatigue'],
    },
    SOLAR,
  );
  assert.equal(r.radiation_flag, 'possible');
  assert.deepEqual(actions(r), EMERGENCY);

  // Vómito + náusea: cumple 'probable' y 'possible'; gana 'probable'.
  const p = run(
    {
      ...SAFE,
      responsive_and_mobile: true,
      vomiting: true,
      time_to_vomiting: 'gt_2h',
      prodromal_symptoms: ['nausea'],
    },
    SOLAR,
  );
  assert.equal(p.radiation_flag, 'probable');
  assert.deepEqual(actions(p), EMERGENCY);
});

test('operador no soportado sigue lanzando error', () => {
  assert.throws(
    () => testCondition({ q: 'x', op: 'regex', value: '.*' }, scope({ x: 'a' })),
    /Operador no soportado/,
  );
});

test('formato del resultado sin cambios (contrato con A)', () => {
  const done = run({ ...SAFE, responsive_and_mobile: true }, NO_SOLAR);
  assert.deepEqual(Object.keys(done).sort(), [
    'escalations',
    'path',
    'radiation_flag',
    'status',
    'triage_category',
  ]);
  assert.ok(Array.isArray(done.path) && done.path.every((p) => typeof p === 'string'));

  const pending = run(SAFE);
  assert.deepEqual(Object.keys(pending).sort(), ['path', 'pending', 'status', 'triage_category']);
});
