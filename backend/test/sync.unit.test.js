'use strict';
// Piezas puras de la sincronización (tarea 8): hash canónico del payload (para detectar el
// mismo client_uuid con otro contenido), igualdad de JSON y UUID derivados de un item.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { payloadHash, canonical } = require('../src/services/syncPush.service');
const { sameJson, entityFor } = require('../src/services/syncEntities');
const { derivedUuid } = require('../src/utils/derivedUuid');
const { uuidFor } = require('../src/simulator/random');
const { isUuid } = require('../src/utils/validate');

const item = (payload, extra = {}) => ({ entity: 'reading', payload, ...extra });

test('hash: no depende del orden de las claves ni del formato de la fecha', () => {
  const a = item({
    indicator_code: 'SPO2',
    measured_at: '2026-11-14T08:00:00Z',
    values: { value: 97 },
    input_method: 'wearable',
  });
  const b = item({
    input_method: 'wearable',
    values: { value: 97 },
    measured_at: '2026-11-14T08:00:00.000Z',
    indicator_code: 'SPO2',
  });
  assert.equal(payloadHash(a), payloadHash(b));
  assert.match(payloadHash(a), /^[0-9a-f]{64}$/);
  assert.deepEqual(canonical({ b: 1, a: { d: 2, c: 3 } }), { a: { c: 3, d: 2 }, b: 1 });
});

test('hash: cambia con el valor, el tipo o la corrección', () => {
  const base = item({ indicator_code: 'SPO2', values: { value: 97 } });
  const h = payloadHash(base);
  assert.notEqual(payloadHash(item({ indicator_code: 'SPO2', values: { value: 96 } })), h);
  assert.notEqual(payloadHash({ ...base, entity: 'habitat_reading' }), h);
  assert.notEqual(
    payloadHash({ ...base, supersedes_uuid: '00000000-0000-4000-8000-000000000001' }),
    h,
  );
  // created_at y priority no son parte del contenido: el reintento puede cambiarlos.
  assert.equal(payloadHash({ ...base, created_at: 'otra', priority: 'emergency' }), h);
});

test('sameJson: igualdad estructural', () => {
  assert.equal(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }), true);
  assert.equal(sameJson({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(sameJson([1, 2], [2, 1]), false);
  assert.equal(sameJson({ v: 1 }, { v: '1' }), false);
});

test('UUID derivados: deterministas, válidos y distintos de los del simulador', () => {
  const id = '9c8babf9-b918-4a43-8664-fbb8feb45cc4';
  const a = derivedUuid('sync-group', id, 'WB_MOOD');
  assert.equal(a, derivedUuid('sync-group', id, 'WB_MOOD'));
  assert.ok(isUuid(a));
  assert.equal(a[14], '8', 'versión 8');
  assert.notEqual(a, derivedUuid('sync-group', id, 'WB_STRESS'));
  assert.notEqual(a, uuidFor('sync-group', id, 'WB_MOOD'));
});

test('registro de tipos: los del contrato sin servicio y los desconocidos se rechazan', () => {
  for (const name of [
    'reading',
    'habitat_reading',
    'wellbeing_checkin',
    'pvt_run',
    'wellbeing_screening',
  ]) {
    assert.ok(entityFor(name).handler, name);
  }
  assert.equal(entityFor('emergency_answer').error.code, 'ENTITY_NOT_SUPPORTED');
  assert.equal(entityFor('support_request').error.code, 'ENTITY_NOT_SUPPORTED');
  assert.equal(entityFor('triage_answer').error.code, 'UNKNOWN_ENTITY');
});
