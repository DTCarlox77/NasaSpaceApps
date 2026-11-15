'use strict';
// Sexo biológico del perfil (migración 009): el motor puede usarlo en una condición y el
// filtro de respuesta (vista clinical_profile) decide quién lo recibe. Sin base de datos.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const catalog = require('../docs/catalogo-indicadores.json');
const { evaluateIndicator, evalCondition } = require('../src/engine/conditions');
const { ruleContext } = require('../src/services/evaluation.service');
const { canAccess, filterAstronautProfile } = require('../src/services/accessPolicy');

const M1 = 'm-1';
const M2 = 'm-2';
const OWNER = 'a-1';
const actors = {
  owner: {
    role: 'astronaut',
    astronaut_id: OWNER,
    crew_role: 'flight_engineer',
    mission_ids: [M1],
  },
  cmo: {
    role: 'astronaut',
    astronaut_id: 'a-2',
    crew_role: 'crew_medical_officer',
    mission_ids: [M1],
  },
  commander: { role: 'astronaut', astronaut_id: 'a-3', crew_role: 'commander', mission_ids: [M1] },
  surgeon: { role: 'flight_surgeon', mission_ids: [M1] },
  bh: { role: 'behavioral_health', mission_ids: [M1] },
  otherSurgeon: { role: 'flight_surgeon', mission_ids: [M2] },
  admin: { role: 'admin', mission_ids: [M1] },
  service: { role: 'service', mission_ids: [M1] },
};

test('conditions.js: una condición sobre sex se evalúa con el contexto del perfil', () => {
  const cond = { field: 'sex', op: 'eq', value: 'female' };
  assert.equal(evalCondition(cond, ruleContext({ components: { value: 1 }, sex: 'female' })), true);
  assert.equal(evalCondition(cond, ruleContext({ components: { value: 1 }, sex: 'male' })), false);
  // Sin dato en el perfil, la condición es falsa (no dispara por falta de datos).
  const ctx = ruleContext({ components: { value: 1 }, derived: {}, sex: null });
  assert.equal('sex' in ctx, false);
  assert.equal(evalCondition(cond, ctx), false);

  const indicator = {
    code: 'TEST',
    rules_version: 1,
    rules: [
      { level: 'caution', when: { all: [cond, { field: 'value', op: 'gte', value: 10 }] } },
      { level: 'normal', when: { all: [] } },
    ],
  };
  const level = (sex) =>
    evaluateIndicator(indicator, ruleContext({ components: { value: 12 }, sex })).level;
  assert.equal(level('female'), 'caution');
  assert.equal(level('male'), 'normal');
  assert.equal(level(null), 'normal');
});

test('contexto: los datos de la lectura ganan sobre el perfil', () => {
  const ctx = ruleContext({ components: { value: 3 }, derived: { avg_7d: 2 }, sex: 'male' });
  assert.deepEqual(ctx, { sex: 'male', value: 3, avg_7d: 2 });
});

test('catálogo: ninguna regla actual usa sex (la radiación no depende del sexo)', () => {
  const uses = (when) =>
    when && (when.field === 'sex' || [...(when.any || []), ...(when.all || [])].some(uses));
  for (const indicator of catalog.indicators) {
    for (const rule of indicator.rules) assert.equal(uses(rule.when), false, indicator.code);
  }
});

test('clinical_profile: el dueño y el equipo clínico de su misión; nadie más', () => {
  const resource = {
    astronaut_id: OWNER,
    mission_id: M1,
    sensitivity: 'standard',
    category: 'physical',
    action: 'read',
    view: 'clinical_profile',
  };
  const expected = {
    owner: true,
    cmo: false,
    commander: false,
    surgeon: true,
    bh: true,
    otherSurgeon: false,
    admin: false,
    service: false,
  };
  for (const [name, actor] of Object.entries(actors)) {
    assert.equal(canAccess(actor, resource), expected[name], name);
  }
  // Escribir no es parte de esta vista (admin lo escribe por PATCH /admin/astronauts/{id}).
  assert.equal(canAccess(actors.surgeon, { ...resource, action: 'write' }), false);
});

test('filterAstronautProfile: quita sex a quien no puede verlo', () => {
  const profile = { astronaut_id: OWNER, call_sign: 'LYRA', sex: 'female' };
  const where = { astronautId: OWNER, missionId: M1 };
  assert.deepEqual(filterAstronautProfile(actors.surgeon, profile, where), profile);
  assert.deepEqual(filterAstronautProfile(actors.owner, profile, where), profile);
  for (const name of ['admin', 'cmo', 'commander', 'otherSurgeon']) {
    const out = filterAstronautProfile(actors[name], profile, where);
    assert.equal('sex' in out, false, name);
    assert.equal(out.call_sign, 'LYRA');
  }
  // Sin dato: el equipo clínico recibe null, no un campo ausente.
  const empty = filterAstronautProfile(actors.bh, { astronaut_id: OWNER }, where);
  assert.equal(empty.sex, null);
});
