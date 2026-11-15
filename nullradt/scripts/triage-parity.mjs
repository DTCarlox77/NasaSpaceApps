#!/usr/bin/env node
/**
 * Prueba de paridad del triaje (sin dependencias; Node 18+). Sin red.
 *
 *   node scripts/triage-parity.mjs
 *
 * 1. Corre escenarios de las pruebas de triaje del backend (backend/test/triage.v2.test.js y
 *    triage.test.js) con el evaluador de la APP (src/core/engine/triage.js) y el protocolo v2 de
 *    respaldo empaquetado (src/data/datasources/local/fallback/triage-protocol-v2.json), y comprueba
 *    que da lo mismo que esperan esas pruebas.
 * 2. Si hay git y la rama origin/backend en este clon: corre los MISMOS escenarios con el evaluador
 *    del backend (leído con `git show`, sin escribir archivos) y exige el mismo resultado completo
 *    (status, categoría, bandera, escalamientos y recorrido). También avisa si los archivos del
 *    motor o el protocolo de respaldo ya no son idénticos a los del backend (→ scripts/sync-engine.mjs).
 * Sale con código 1 si algo no coincide.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { isDeepStrictEqual } from 'node:util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const app = require(join(ROOT, 'src', 'core', 'engine', 'triage.js'));
const fallback = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'datasources', 'local', 'fallback', 'triage-protocol-v2.json'), 'utf8'));
const V2 = fallback.definition;

const SOLAR = { solar_event_active: true };
const NO_SOLAR = { solar_event_active: false };
const SAFE = { responder_safe: true };
const PATIENT_REPORTED = ['vomiting', 'time_to_vomiting', 'prodromal_symptoms'];
const OBSERVABLE = ['vomiting_observed', 'time_to_vomiting_observed', 'consciousness_level'];
const asked = (r) => (r.path || []).map((s) => s.split('=')[0]);
const actions = (r) => (r.escalations || []).map((e) => `${e.level}:${e.priority}`);
const EMERGENCY = ['crew:emergency', 'flight_surgeon:emergency'];
const URGENT = ['crew:urgent', 'flight_surgeon:urgent'];
const ROUTINE = ['self_care:routine', 'crew:routine'];

/** Escenarios tomados de las pruebas del backend, con lo que esas pruebas exigen. */
const SCENARIOS = [
  {
    name: 'v2 · no obedece órdenes → rojo, solo signos observables, radiación probable',
    from: 'triage.v2.test.js',
    answers: { ...SAFE, responsive_and_mobile: false, breathing: true, resp_rate_over_30: false, perfusion_ok: true, follows_commands: false, vomiting_observed: true, time_to_vomiting_observed: 'lt_1h', consciousness_level: 'pain' },
    context: SOLAR,
    expect: (r) => [
      ['status', r.status, 'completed'],
      ['triage_category', r.triage_category, 'red'],
      ['radiation_flag', r.radiation_flag, 'probable'],
      ['sin preguntas al paciente', PATIENT_REPORTED.some((c) => asked(r).includes(c)), false],
      ['con las observables', OBSERVABLE.every((c) => asked(r).includes(c)), true],
      ['escalamientos', actions(r), EMERGENCY],
    ],
  },
  {
    name: 'v2 · rojo que sí puede contestar → síntomas como en la v1, radiación posible',
    from: 'triage.v2.test.js',
    answers: { ...SAFE, responsive_and_mobile: false, breathing: true, resp_rate_over_30: true, can_self_report: true, vomiting: false, prodromal_symptoms: ['nausea'] },
    context: SOLAR,
    expect: (r) => [
      ['triage_category', r.triage_category, 'red'],
      ['radiation_flag', r.radiation_flag, 'possible'],
      ['pregunta síntomas', asked(r).includes('prodromal_symptoms'), true],
    ],
  },
  {
    name: 'v2 · falta una respuesta observable → incompleta con esa pregunta pendiente',
    from: 'triage.v2.test.js',
    answers: { ...SAFE, responsive_and_mobile: false, breathing: true, resp_rate_over_30: false, perfusion_ok: true, follows_commands: false },
    context: SOLAR,
    expect: (r) => [
      ['status', r.status, 'incomplete'],
      ['pending', r.pending, 'vomiting_observed'],
    ],
  },
  {
    name: 'v2 · sin evento solar se omite el módulo de radiación',
    from: 'triage.v2.test.js',
    answers: { ...SAFE, responsive_and_mobile: false, breathing: true, resp_rate_over_30: false, perfusion_ok: true, follows_commands: false },
    context: NO_SOLAR,
    expect: (r) => [
      ['status', r.status, 'completed'],
      ['radiation_flag', r.radiation_flag, 'none'],
      ['módulo omitido', r.path.includes('vomiting_observed:omitida'), true],
    ],
  },
  {
    name: 'caso 7 · respuestas envueltas como las guarda la API ({ value } / { choice }) → amarillo',
    from: 'triage.test.js',
    answers: { responder_safe: { value: true }, responsive_and_mobile: { value: false }, breathing: { value: true }, resp_rate_over_30: { value: false }, perfusion_ok: { value: true }, follows_commands: { value: true } },
    context: {},
    expect: (r) => [
      ['status', r.status, 'completed'],
      ['triage_category', r.triage_category, 'yellow'],
      ['escalamientos', actions(r), URGENT],
    ],
  },
  {
    name: '1 · responde y se desplaza (sin evento solar) → verde, rutina',
    from: 'triage.test.js',
    answers: { ...SAFE, responsive_and_mobile: true },
    context: NO_SOLAR,
    expect: (r) => [
      ['status', r.status, 'completed'],
      ['triage_category', r.triage_category, 'green'],
      ['radiation_flag', r.radiation_flag, 'none'],
      ['escalamientos', actions(r), ROUTINE],
    ],
  },
];

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  failures += 1;
  console.log(`  ✗ ${msg}`);
};

console.log(`Protocolo de respaldo: ${fallback.code} v${fallback.version} (copiado de ${fallback.copied_from?.file} @ ${fallback.copied_from?.commit})\n`);
console.log('1) Evaluador de la app contra lo que exigen las pruebas del backend');
const appResults = SCENARIOS.map((s) => {
  const r = app.evaluateAssessment(V2, s.answers, s.context);
  const checks = s.expect(r);
  const bad = checks.filter(([, got, want]) => !isDeepStrictEqual(got, want));
  if (bad.length) fail(`${s.name}\n      ${bad.map(([k, got, want]) => `${k}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`).join('\n      ')}`);
  else ok(`${s.name}  [${s.from}]`);
  return r;
});

// ------------------------------------------------------------------ 2) contra el backend real
let git = null;
try {
  const run = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
  run('rev-parse', '--verify', 'origin/backend');
  git = run;
} catch {
  git = null;
}

console.log('\n2) Evaluador del backend (origin/backend) con los mismos escenarios');
if (!git) {
  console.log('  – omitido: sin git o sin la rama origin/backend en este clon (git fetch origin backend)');
} else {
  const commit = git('rev-parse', '--short', 'origin/backend').trim();
  const src = (p) => git('show', `origin/backend:${p}`);
  // Carga el evaluador del backend en memoria (sin escribir archivos), con su propio require('./conditions').
  const load = (code, requireFn) => {
    const module = { exports: {} };
    vm.runInThisContext(`(function (exports, require, module) {${code}\n})`)(module.exports, requireFn, module);
    return module.exports;
  };
  const backendConditions = load(src('backend/src/engine/conditions.js'), require);
  const backendTriage = load(src('backend/src/engine/triage.js'), (p) => (p === './conditions' ? backendConditions : require(p)));
  const seed = src('backend/db/seeds/004_protocolo_triaje_v2.sql');
  const blocks = [...seed.matchAll(/\$json\$([\s\S]*?)\$json\$/g)].map((m) => JSON.parse(m[1]));
  const seedV2 = blocks.find((b) => b && !Array.isArray(b) && Array.isArray(b.questions));

  SCENARIOS.forEach((s, i) => {
    const backend = backendTriage.evaluateAssessment(seedV2, s.answers, s.context);
    if (isDeepStrictEqual(backend, appResults[i])) ok(`mismo resultado completo: ${s.name.split(' → ')[0]}`);
    else fail(`difiere del backend (${commit}): ${s.name}\n      app:     ${JSON.stringify(appResults[i])}\n      backend: ${JSON.stringify(backend)}`);
  });

  console.log(`\n3) ¿Copias idénticas a origin/backend (${commit})?`);
  for (const name of ['conditions.js', 'triage.js']) {
    const mine = readFileSync(join(ROOT, 'src', 'core', 'engine', name), 'utf8').replace(/\r\n/g, '\n');
    if (mine === src(`backend/src/engine/${name}`).replace(/\r\n/g, '\n')) ok(`src/core/engine/${name}`);
    else console.log(`  ! AVISO: src/core/engine/${name} difiere del backend → node scripts/sync-engine.mjs`);
  }
  if (isDeepStrictEqual(seedV2, V2)) ok('protocolo de respaldo = seed 004 (v2)');
  else console.log('  ! AVISO: el protocolo de respaldo difiere del seed v2 → node scripts/sync-engine.mjs');
}

console.log(failures ? `\n✗ ${failures} escenario(s) no coinciden` : '\n✓ Paridad OK: la app clasifica igual que el backend');
process.exit(failures ? 1 : 0);
