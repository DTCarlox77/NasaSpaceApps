'use strict';
// Bienestar (tarea 10), funciones puras: mensaje neutro, racha, PHQ-2/GAD-2 pendientes,
// enrutamiento de lo conductual (con la alerta de estado al flight surgeon), días esperados
// del cumplimiento y validación del check-in. Sin base.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../docs/catalogo-indicadores.json');
const {
  neutralMessage,
  streakFrom,
  screeningDue,
  validateCheckin,
} = require('../src/services/wellbeing.service');
const { routeEvaluation } = require('../src/services/escalation.service');
const { expectedDays } = require('../src/services/behavioral.service');
const { suggestionsFor } = require('../src/services/supportRequest.service');

const DAY = 24 * 60 * 60 * 1000;
const rules = (code) => catalog.indicators.find((i) => i.code === code).rules;
const rule = (code, level, escalation) =>
  rules(code).find((r) => r.level === level && (!escalation || r.escalation === escalation));

test('mensaje neutro: la regla más relevante del catálogo, nunca un nivel ni un número', () => {
  const ev = (level, escalation, code = 'WB_MOOD') => ({
    indicator_code: code,
    level,
    escalation,
    recommendation: rule(code, level, escalation).recommendation,
  });
  const unrated = ev('unrated', 'self_care');
  const normal = ev('normal', 'self_care');
  const selfCare = ev('caution', 'self_care', 'WB_STRESS');
  const toBh = ev('caution', 'behavioral_health', 'WB_FATIGUE');
  assert.equal(neutralMessage([normal, unrated, normal], 'x'), unrated.recommendation);
  assert.equal(neutralMessage([normal, selfCare, unrated], 'x'), selfCare.recommendation);
  assert.equal(neutralMessage([selfCare, toBh, normal], 'x'), toBh.recommendation);
  assert.equal(neutralMessage([normal, normal], 'x'), 'Gracias por tu check-in.');
  assert.equal(neutralMessage([], 'Gracias por tu check-in.'), 'Gracias por tu check-in.');
  for (const e of [unrated, normal, selfCare, toBh]) {
    assert.ok(!/\d/.test(e.recommendation), 'sin puntajes en el texto');
    assert.ok(!/rojo|crítico|caution|critical/i.test(e.recommendation), 'sin colores ni niveles');
  }
});

test('racha: cuenta días con check-in (hoy o hasta ayer), nunca el resultado', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  const day = (k) => new Date(now - k * DAY).toISOString().slice(0, 10);
  assert.deepEqual(streakFrom([], now), {
    streak_days: 0,
    checkins_this_week: 0,
    checkins_goal_week: 7,
  });
  assert.equal(streakFrom([day(0), day(1), day(2)], now).streak_days, 3);
  // Hoy todavía no: la racha sigue viva hasta ayer.
  assert.equal(streakFrom([day(1), day(2)], now).streak_days, 2);
  // Un hueco la corta.
  assert.equal(streakFrom([day(0), day(2), day(3)], now).streak_days, 1);
  assert.equal(streakFrom([day(2), day(3)], now).streak_days, 0);
  assert.equal(streakFrom([day(0), day(3), day(6), day(7)], now).checkins_this_week, 3);
});

test('PHQ-2/GAD-2: tocan cada 14 días, un día antes de la conferencia (regla de diseño)', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  const at = (d) => new Date(now - d * DAY).toISOString();
  assert.equal(screeningDue(new Map(), now, 14), true, 'nunca se hicieron');
  assert.equal(
    screeningDue(
      new Map([
        ['PHQ2', at(1)],
        ['GAD2', at(1)],
      ]),
      now,
      14,
    ),
    false,
  );
  assert.equal(
    screeningDue(
      new Map([
        ['PHQ2', at(13)],
        ['GAD2', at(1)],
      ]),
      now,
      14,
    ),
    true,
  );
  assert.equal(
    screeningDue(
      new Map([
        ['PHQ2', at(12)],
        ['GAD2', at(12)],
      ]),
      now,
      14,
    ),
    false,
  );
  assert.equal(screeningDue(new Map([['PHQ2', at(1)]]), now, 14), true, 'falta GAD-2');
});

test('conductual: el detalle solo a behavioral_health; el flight surgeon, solo el estado', () => {
  const behavioral = { code: 'PVT_LAPSES', sensitivity: 'confidential' };
  const critical = routeEvaluation(behavioral, { level: 'critical', escalation: 'flight_surgeon' });
  assert.deepEqual(
    critical.map((t) => [t.level, t.isConfidential, t.category, Boolean(t.statusOnly)]),
    [
      ['behavioral_health', true, 'behavioral', false],
      ['flight_surgeon', false, 'behavioral', true],
    ],
  );
  assert.ok(
    critical.every((t) => t.level !== 'crew'),
    'nunca a bordo',
  );
  // Lo que el catálogo escala solo a behavioral_health no llega al flight surgeon.
  const wb = routeEvaluation(
    { code: 'WB_MOOD', sensitivity: 'confidential' },
    { level: 'caution', escalation: 'behavioral_health' },
  );
  assert.deepEqual(
    wb.map((t) => t.level),
    ['behavioral_health'],
  );
  // El catálogo solo escala PVT_LAPSES crítico al flight surgeon.
  const toFs = catalog.indicators
    .filter((i) => i.sensitivity === 'confidential')
    .flatMap((i) => i.rules.filter((r) => r.escalation === 'flight_surgeon').map(() => i.code));
  assert.deepEqual(toFs, ['PVT_LAPSES']);
});

test('cumplimiento: check-ins esperados = días UTC del rango desde la asignación', () => {
  const from = Date.parse('2026-11-09T00:00:00Z');
  const to = Date.parse('2026-11-15T12:00:00Z');
  assert.equal(expectedDays(from, to, '2026-09-01T00:00:00Z'), 7);
  assert.equal(expectedDays(from, to, '2026-11-14T18:00:00Z'), 2);
  assert.equal(expectedDays(from, to, '2026-11-16T00:00:00Z'), 0);
  assert.equal(expectedDays(from, Date.parse('2026-11-16T00:00:00Z'), '2026-01-01'), 7);
});

test('check-in: deslizadores enteros 0–100; sueño opcional; nota hasta 1000', () => {
  const ok = {
    client_uuid: 'ca000000-0000-4000-8000-000000000001',
    measured_at: '2026-11-14T06:45:00Z',
    mood: 62,
    fatigue: 40,
    stress: 35,
    crew_conflict: 10,
  };
  assert.equal(validateCheckin(ok).sleep_hours, null);
  assert.equal(validateCheckin({ ...ok, sleep_hours: 6.5 }).sleep_hours, 6.5);
  const fields = (body, opts) => {
    try {
      validateCheckin(body, opts);
      return [];
    } catch (err) {
      return err.details.map((d) => d.field);
    }
  };
  assert.deepEqual(fields({ ...ok, mood: 101, stress: 2.5 }), ['mood', 'stress']);
  assert.deepEqual(fields({ ...ok, sleep_hours: 25 }), ['sleep_hours']);
  assert.deepEqual(fields({ ...ok, private_note: 'x'.repeat(1001) }), ['private_note']);
  assert.deepEqual(fields({ ...ok, client_uuid: 'no' }), ['client_uuid']);
  // Por sync el client_uuid va en el item y los campos llevan el prefijo del payload.
  assert.deepEqual(
    fields(
      { ...ok, client_uuid: undefined, fatigue: -1 },
      { prefix: 'payload.', clientUuid: ok.client_uuid },
    ),
    ['payload.fatigue'],
  );
});

test('urgencia now: sugerencias (respiración guiada y oficial médico); el resto, ninguna', () => {
  assert.deepEqual(
    suggestionsFor('now').map((s) => s.code),
    ['guided_breathing', 'talk_to_cmo'],
  );
  assert.ok(/nadie a bordo recibe un aviso/.test(suggestionsFor('now')[1].description));
  assert.deepEqual(suggestionsFor('today'), []);
  assert.deepEqual(suggestionsFor('later'), []);
});
