'use strict';
// Enrutamiento de escalamientos y tendencia del dashboard: funciones puras, sin base.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const { routeEvaluation, priorityFor } = require('../src/services/escalation.service');
const { trendOf, primaryValue, expectedCheckins } = require('../src/services/dashboard.service');

const physical = { code: 'BLOOD_PRESSURE', sensitivity: 'standard' };
const behavioral = { code: 'WB_MOOD', sensitivity: 'confidential' };
const levels = (targets) => targets.map((t) => t.level);

test('físico: crew solo a bordo; flight_surgeon a Tierra', () => {
  assert.deepEqual(levels(routeEvaluation(physical, { level: 'caution', escalation: 'crew' })), [
    'crew',
  ]);
  assert.deepEqual(
    levels(routeEvaluation(physical, { level: 'caution', escalation: 'flight_surgeon' })),
    ['flight_surgeon'],
  );
});

test('físico critical a flight_surgeon avisa también a bordo', () => {
  const targets = routeEvaluation(physical, { level: 'critical', escalation: 'flight_surgeon' });
  assert.deepEqual(levels(targets), ['flight_surgeon', 'crew']);
  assert.ok(targets.every((t) => t.category === 'physical' && !t.isConfidential));
  assert.ok(targets.every((t) => t.sourceType === 'reading'));
});

test('self_care no escala', () => {
  assert.deepEqual(routeEvaluation(physical, { level: 'normal', escalation: 'self_care' }), []);
  assert.deepEqual(routeEvaluation(behavioral, { level: 'normal', escalation: 'self_care' }), []);
});

test('conductual: solo behavioral_health, confidencial, nunca a bordo', () => {
  for (const evaluation of [
    { level: 'caution', escalation: 'behavioral_health' },
    // PVT_LAPSES critical dice flight_surgeon: lo conductual igual va solo a behavioral_health.
    { level: 'critical', escalation: 'flight_surgeon' },
  ]) {
    assert.deepEqual(routeEvaluation(behavioral, evaluation), [
      {
        level: 'behavioral_health',
        category: 'behavioral',
        sourceType: 'wellbeing',
        isConfidential: true,
      },
    ]);
  }
  assert.deepEqual(routeEvaluation(behavioral, { level: 'caution', escalation: 'crew' }), []);
});

test('prioridad: critical = urgent, caution = routine', () => {
  assert.equal(priorityFor('critical'), 'urgent');
  assert.equal(priorityFor('caution'), 'routine');
});

test('tendencia: rising, falling, stable e insufficient_data', () => {
  const s = (...values) => values.map((value, i) => ({ measured_at: `t${i}`, value }));
  assert.equal(trendOf(s(120)), 'insufficient_data');
  assert.equal(trendOf(s()), 'insufficient_data');
  assert.equal(trendOf(s(120, 125, 145)), 'rising');
  assert.equal(trendOf(s(98, 97, 88)), 'falling');
  assert.equal(trendOf(s(36.6, 36.8, 36.7)), 'stable');
  assert.equal(trendOf(s(0, 0, 3)), 'rising');
});

test('valor principal de la serie', () => {
  assert.equal(primaryValue({ value: 97 }), 97);
  assert.equal(primaryValue({ systolic: 145, diastolic: 88 }), 145);
  assert.equal(primaryValue({ symptoms: ['cough'], severity: 2 }), 2);
  assert.equal(primaryValue({ near_blur: true }), null);
});

test('check-ins esperados: días de asignación hasta 7', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  assert.equal(expectedCheckins('2026-09-30T08:00:00Z', now), 7);
  assert.equal(expectedCheckins('2026-11-12T12:00:00Z', now), 2);
  assert.equal(expectedCheckins('2026-11-14T11:00:00Z', now), 1);
});
