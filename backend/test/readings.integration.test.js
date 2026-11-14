'use strict';
// Integración del motor de semáforo: catálogo, POST /readings, hábitat, series y body-status.
// Usa la base de PRUEBAS (DB_NAME_TEST), reiniciada al empezar la suite bajo el advisory lock.
const { openTestDb, resetDatabase } = require('./helpers/db'); // antes que cualquier src/
process.env.RATE_LIMIT_LOGIN_PER_MINUTE = '1000';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const catalog = require(path.join(__dirname, '..', 'docs', 'catalogo-indicadores.json'));
const byCode = Object.fromEntries(catalog.indicators.map((i) => [i.code, i]));
const A = {
  orion: '10000000-0000-4000-8000-000000000011',
  vega: '10000000-0000-4000-8000-000000000012',
};
const ORION_USER = '00000000-0000-4000-8000-000000000011';
const ARES1 = '20000000-0000-4000-8000-000000000001';
const DAY = 24 * 60 * 60 * 1000;

let db = null;
let SKIP_REASON = '';
let request = null;
let app = null;
const tokens = {};

before(async () => {
  const opened = await openTestDb();
  db = opened.db;
  SKIP_REASON = opened.reason;
  if (!db) return;
  await resetDatabase();
  request = require('supertest');
  app = require('../src/app');
  for (const [name, username] of Object.entries({
    orion: 'a.ortega',
    vega: 'k.mensah',
    lyra: 'l.tanaka',
    reyes: 'dr.reyes',
    bh: 'bh.salas',
    svc: 'svc.habitat',
  })) {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username, password: 'Demo2026!', device_id: 'tab-test' });
    assert.equal(res.status, 200, `login ${username}`);
    tokens[name] = res.body.access_token;
  }
});

after(async () => {
  if (!db) return;
  await require('../src/config/db').pool.end();
  await db.close();
});

const skip = (t) => {
  if (db) return false;
  t.skip(SKIP_REASON);
  return true;
};
const as = (who) => ({ Authorization: `Bearer ${tokens[who]}` });
const ago = (days, hours = 0) => new Date(Date.now() - days * DAY - hours * 3600000).toISOString();
const q = async (sql, params) => (await db.pool.query(sql, params)).rows;
const methodOf = (code) => byCode[code].input_methods[0];

function postReading(who, code, values, extra = {}) {
  return request(app)
    .post('/api/v1/readings')
    .set(as(who))
    .send({
      client_uuid: crypto.randomUUID(),
      indicator_code: code,
      measured_at: new Date().toISOString(),
      values,
      input_method: methodOf(code),
      ...extra,
    });
}

function postHabitat(readings) {
  return request(app).post('/api/v1/habitat/readings').set(as('svc')).send({ readings });
}

test('catálogo: /indicators es igual a docs/catalogo-indicadores.json (sin reglas)', async (t) => {
  if (skip(t)) return;
  const res = await request(app).get('/api/v1/indicators').set(as('orion'));
  assert.equal(res.status, 200);
  assert.equal(res.body.catalog_version, catalog.catalog_version);
  assert.equal(res.body.rules_version, 1);
  const expected = catalog.indicators.map(({ rules: _rules, ...rest }) => rest);
  assert.deepEqual(res.body.items, expected);

  const conf = await request(app)
    .get('/api/v1/indicators?sensitivity=confidential')
    .set(as('reyes'));
  assert.equal(conf.body.items.length, 9);
  const heart = await request(app).get('/api/v1/indicators?body_zone=heart').set(as('orion'));
  assert.deepEqual(
    heart.body.items.map((i) => i.code),
    ['BLOOD_PRESSURE', 'HEART_RATE'],
  );

  const spo2 = await request(app).get('/api/v1/indicators/SPO2').set(as('orion'));
  assert.equal(spo2.status, 200);
  assert.deepEqual(spo2.body.rules, byCode.SPO2.rules);
  assert.deepEqual(spo2.body.guide, byCode.SPO2.guide);
  assert.equal(
    (await request(app).get('/api/v1/indicators/NO_EXISTE').set(as('orion'))).status,
    404,
  );
});

test('catálogo: /rules versionadas, /body-zones y /symptoms', async (t) => {
  if (skip(t)) return;
  const all = await request(app).get('/api/v1/rules').set(as('orion'));
  assert.equal(all.status, 200);
  assert.equal(all.body.up_to_date, false);
  assert.equal(all.body.indicators.length, 26);
  assert.deepEqual(
    all.body.indicators.find((i) => i.code === 'HEART_RATE').rules,
    byCode.HEART_RATE.rules,
  );
  const since = await request(app).get('/api/v1/rules?since_version=1').set(as('orion'));
  assert.deepEqual(since.body.indicators, []);
  assert.equal(since.body.up_to_date, true);
  assert.equal(
    (await request(app).get('/api/v1/rules?since_version=-1').set(as('orion'))).status,
    400,
  );

  const zones = await request(app).get('/api/v1/body-zones').set(as('orion'));
  assert.deepEqual(zones.body.items, catalog.body_zones);
  const symptoms = await request(app).get('/api/v1/symptoms').set(as('orion'));
  assert.deepEqual(symptoms.body.items, catalog.symptoms);
  assert.equal((await request(app).get('/api/v1/indicators')).status, 401);
});

test('BP 185/100 → critical + escalamiento a Tierra con deliver_at y aviso a bordo', async (t) => {
  if (skip(t)) return;
  const res = await postReading('orion', 'BLOOD_PRESSURE', { systolic: 185, diastolic: 100 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.evaluation.level, 'critical');
  assert.equal(res.body.evaluation.escalation, 'flight_surgeon');
  assert.equal(res.body.evaluation.rules_version, 1);
  assert.equal(res.body.reading.values.systolic, 185);
  assert.equal(res.body.reading.input_method, 'manual');
  assert.ok(res.body.escalation_id);

  const rows = await q(
    `SELECT id, level, priority, status, category, source_type,
            extract(epoch FROM deliver_at - created_at)::int AS delay
     FROM escalations WHERE source_id = $1 ORDER BY level`,
    [res.body.reading.id],
  );
  assert.deepEqual(
    rows.map(({ id: _id, ...r }) => r),
    [
      {
        level: 'crew',
        priority: 'urgent',
        status: 'delivered',
        category: 'physical',
        source_type: 'reading',
        delay: 0,
      },
      {
        level: 'flight_surgeon',
        priority: 'urgent',
        status: 'queued',
        category: 'physical',
        source_type: 'reading',
        delay: 90,
      },
    ],
  );
  assert.equal(rows.find((r) => r.level === 'flight_surgeon').id, res.body.escalation_id);
  const [evaluation] = await q(
    'SELECT level, rules_version, escalation_id FROM reading_evaluations WHERE reading_id = $1',
    [res.body.reading.id],
  );
  assert.deepEqual(evaluation, {
    level: 'critical',
    rules_version: 1,
    escalation_id: res.body.escalation_id,
  });
});

test('mismo client_uuid dos veces → 200 con lo existente, sin duplicar', async (t) => {
  if (skip(t)) return;
  const clientUuid = crypto.randomUUID();
  const first = await postReading(
    'orion',
    'HEART_RATE',
    { value: 131 },
    { client_uuid: clientUuid },
  );
  assert.equal(first.status, 201);
  const again = await postReading(
    'orion',
    'HEART_RATE',
    { value: 60 },
    { client_uuid: clientUuid },
  );
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, first.body, 'devuelve el registro y la evaluación originales');
  const [counts] = await q(
    `SELECT (SELECT count(*)::int FROM readings WHERE client_uuid = $1) AS readings,
            (SELECT count(*)::int FROM escalations WHERE source_id = $2) AS escalations`,
    [clientUuid, first.body.reading.id],
  );
  assert.deepEqual(counts, { readings: 1, escalations: 2 });
});

test('supersedes: la corrección se acepta una vez; la segunda → 409', async (t) => {
  if (skip(t)) return;
  const original = await postReading('orion', 'SPO2', { value: 90 });
  assert.equal(original.body.evaluation.level, 'critical');
  const uuid = original.body.reading.client_uuid;
  const fix = await postReading('orion', 'SPO2', { value: 97 }, { supersedes_uuid: uuid });
  assert.equal(fix.status, 201);
  assert.equal(fix.body.reading.supersedes_uuid, uuid);
  assert.equal(fix.body.evaluation.level, 'normal');

  const second = await postReading('orion', 'SPO2', { value: 96 }, { supersedes_uuid: uuid });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'CONFLICT');
  const missing = await postReading(
    'orion',
    'SPO2',
    { value: 96 },
    { supersedes_uuid: crypto.randomUUID() },
  );
  assert.equal(missing.status, 409);
  const otherIndicator = await postReading(
    'orion',
    'HEART_RATE',
    { value: 70 },
    { supersedes_uuid: fix.body.reading.client_uuid },
  );
  assert.equal(otherIndicator.status, 400);

  const series = await request(app).get('/api/v1/me/readings?code=SPO2').set(as('orion'));
  assert.deepEqual(
    series.body.items.map((i) => i.values.value),
    [97],
    'la lectura corregida no aparece en la serie',
  );
});

test('SLEEP_HOURS: 7 noches seguidas ≤ 6 h → critical (y 3 → caution crew)', async (t) => {
  if (skip(t)) return;
  const levels = [];
  for (let night = 6; night >= 0; night -= 1) {
    const res = await postReading(
      'orion',
      'SLEEP_HOURS',
      { value: 5.5 },
      { measured_at: ago(night) },
    );
    assert.equal(res.status, 201);
    levels.push(`${res.body.evaluation.level}/${res.body.evaluation.escalation}`);
  }
  assert.equal(levels[2], 'caution/crew', 'tercera noche');
  assert.equal(levels[6], 'critical/flight_surgeon', 'séptima noche');
});

test('HAB_CO2: avg_7d ≥ 2.5 → caution (crew); sin historial no hay promedio', async (t) => {
  if (skip(t)) return;
  const item = (value, days) => ({
    client_uuid: crypto.randomUUID(),
    indicator_code: 'HAB_CO2',
    module_id: 'HAB-1',
    measured_at: ago(days),
    value,
    source: 'simulator',
  });
  const first = await postHabitat([item(2.6, 3)]);
  assert.equal(first.body.results[0].evaluation.level, 'normal', 'una sola lectura: sin avg_7d');
  await postHabitat([item(2.7, 2), item(2.6, 1)]);
  const res = await postHabitat([item(2.6, 0)]);
  assert.equal(res.status, 200);
  const [result] = res.body.results;
  assert.equal(result.status, 'accepted');
  assert.equal(result.evaluation.level, 'caution');
  assert.equal(result.evaluation.escalation, 'crew');
  assert.equal(result.evaluation.rule_index, 3, 'regla del promedio de 7 días');
  const [stored] = await q('SELECT derived FROM reading_evaluations WHERE reading_id = $1', [
    result.reading_id,
  ]);
  assert.ok(Math.abs(stored.derived.avg_7d - 2.625) < 1e-9);
});

test('BODY_MASS −6 % contra la primera lectura de la misión → caution', async (t) => {
  if (skip(t)) return;
  const base = await postReading('orion', 'BODY_MASS', { value: 74 }, { measured_at: ago(20) });
  assert.equal(base.body.evaluation.level, 'normal', 'la primera lectura es la línea base');
  const res = await postReading('orion', 'BODY_MASS', { value: 69.56 });
  assert.equal(res.body.evaluation.level, 'caution');
  assert.equal(res.body.evaluation.escalation, 'flight_surgeon');
  assert.ok(res.body.escalation_id);
});

test('WB_MOOD por /readings → 400 (entra solo por /wellbeing)', async (t) => {
  if (skip(t)) return;
  for (const [code, values] of [
    ['WB_MOOD', { value: 50 }],
    ['PHQ2_SCORE', { value: 2, item_1: 1, item_2: 1 }],
    ['PVT_LAPSES', { value: 2, device_id: 'TAB-1' }],
  ]) {
    const res = await postReading('orion', code, values);
    assert.equal(res.status, 400, code);
    assert.equal(res.body.error.details[0].field, 'indicator_code');
  }
  const habitat = await postReading('orion', 'HAB_TEMP', { value: 22, module_id: 'HAB-1' });
  assert.equal(habitat.status, 400, 'el hábitat va por /habitat/readings');
});

test('validación de components: requeridos, tipos, síntomas y unidades', async (t) => {
  if (skip(t)) return;
  const fields = async (code, values, extra) =>
    (await postReading('orion', code, values, extra)).body.error.details.map((d) => d.field).sort();
  assert.deepEqual(await fields('BLOOD_PRESSURE', { systolic: 120 }), ['values.diastolic']);
  assert.deepEqual(await fields('GLUCOSE', { value: '90', fasting: true }), ['values.value']);
  assert.deepEqual(await fields('BODY_TEMP', { value: 98.6 }), ['values.value'], '°F en vez de °C');
  assert.deepEqual(await fields('HEART_RATE', { value: 70, extra: 1 }), ['values.extra']);
  assert.deepEqual(await fields('SYMPTOM', { symptoms: ['dolor_raro'] }), ['values.symptoms']);
  assert.deepEqual(
    await fields('BLOOD_PRESSURE', { systolic: 120, diastolic: 80 }, { input_method: 'wearable' }),
    ['input_method'],
  );
  assert.deepEqual(
    await fields('SPO2', { value: 97 }, { measured_at: new Date(Date.now() + DAY).toISOString() }),
    ['measured_at'],
  );
  assert.deepEqual(await fields('SPO2', { value: 97 }, { attachment_id: crypto.randomUUID() }), [
    'attachment_id',
  ]);
});

test('un astronauta no puede leer las lecturas de otro', async (t) => {
  if (skip(t)) return;
  // LYRA (ingeniera de vuelo) no es CMO: no ve nada de ORION.
  const lyra = await request(app).get('/api/v1/me/readings').set(as('lyra'));
  assert.equal(lyra.status, 200);
  assert.deepEqual(lyra.body.items, [], '/me/readings solo devuelve lo propio');
  const { loadActor, canAccess, enforceAccess } = require('../src/services/accessPolicy');
  const actor = await loadActor('00000000-0000-4000-8000-000000000013');
  const orionData = {
    astronaut_id: A.orion,
    mission_id: ARES1,
    sensitivity: 'standard',
    category: 'physical',
    action: 'read',
  };
  assert.equal(canAccess(actor, orionData), false);
  assert.equal(
    canAccess(actor, { ...orionData, sensitivity: 'confidential', category: 'behavioral' }),
    false,
  );
  await assert.rejects(enforceAccess(actor, orionData), (err) => err.status === 403);
});

test('body-status: peor nivel por zona, sin color confidencial y check-in sí/no', async (t) => {
  if (skip(t)) return;
  // Bienestar confidencial de ORION (entraría por /wellbeing, tarea 10): no debe colorear.
  const [checkin] = await q(
    `INSERT INTO wellbeing_checkins (client_uuid, astronaut_id, measured_at, sleep_hours)
     VALUES (gen_random_uuid(), $1, now(), 5) RETURNING id`,
    [A.orion],
  );
  const [wb] = await q(
    `INSERT INTO readings (client_uuid, recorded_by, mission_id, astronaut_id, indicator_code,
                           components, source, measured_at, wellbeing_checkin_id)
     VALUES (gen_random_uuid(), $1, $2, $3, 'WB_STRESS', '{"value": 95}', 'slider', now(), $4) RETURNING id`,
    [ORION_USER, ARES1, A.orion, checkin.id],
  );
  await q(
    `INSERT INTO reading_evaluations (reading_id, indicator_code, level, rule_index, rules_version, escalation)
     VALUES ($1, 'WB_STRESS', 'critical', 0, 1, 'behavioral_health')`,
    [wb.id],
  );

  const res = await request(app).get('/api/v1/me/body-status').set(as('orion'));
  assert.equal(res.status, 200);
  const zones = Object.fromEntries(res.body.zones.map((z) => [z.zone, z]));
  assert.deepEqual(Object.keys(zones), [
    'heart',
    'lungs',
    'immune',
    'metabolism',
    'muscle',
    'bones',
    'brain',
    'eyes',
  ]);
  assert.equal(zones.heart.worst_level, 'critical', 'BP 185/100 y pulso 131');
  assert.equal(zones.lungs.worst_level, 'normal', 'SPO2 corregido a 97');
  assert.equal(zones.muscle.worst_level, 'caution', 'masa −6 %');
  assert.equal(zones.eyes.worst_level, 'unrated', 'sin datos');
  assert.equal(zones.brain.worst_level, 'critical', 'solo SLEEP_HOURS colorea');
  assert.deepEqual(
    zones.brain.indicators.map((i) => i.code),
    ['SLEEP_HOURS'],
  );
  assert.equal(zones.brain.checkin_completed, true);
  assert.ok(!JSON.stringify(res.body).includes('WB_'), 'ningún indicador confidencial');
  assert.equal(res.body.environment.module_id, 'HAB-1');
  assert.equal(res.body.environment.worst_level, 'caution');

  const vega = await request(app).get('/api/v1/me/body-status').set(as('vega'));
  const brain = vega.body.zones.find((z) => z.zone === 'brain');
  assert.equal(brain.checkin_completed, false);
  assert.ok(
    vega.body.zones.every((z) => z.worst_level === 'unrated'),
    'VEGA no tiene datos propios',
  );
});

test('rol service: POST /habitat/readings OK (accepted, duplicate, rejected) y GET /me → 403', async (t) => {
  if (skip(t)) return;
  const uuid = crypto.randomUUID();
  const ok = {
    client_uuid: uuid,
    indicator_code: 'HAB_NOISE',
    module_id: 'HAB-2',
    measured_at: new Date().toISOString(),
    value: 55,
    period: 'work',
    source: 'sensor',
  };
  const res = await postHabitat([
    ok,
    ok,
    { ...ok, client_uuid: crypto.randomUUID(), period: undefined },
  ]);
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.results.map((r) => r.status),
    ['accepted', 'duplicate', 'rejected'],
  );
  assert.equal(res.body.results[2].error.code, 'VALIDATION_ERROR');
  assert.equal(res.body.results[2].error.details[0].field, 'period');
  assert.equal((await request(app).get('/api/v1/me').set(as('svc'))).status, 403);
  assert.equal((await request(app).get('/api/v1/habitat/status').set(as('svc'))).status, 403);

  const status = await request(app).get('/api/v1/habitat/status?module_id=HAB-2').set(as('reyes'));
  assert.equal(status.status, 200);
  assert.deepEqual(
    status.body.modules.map((m) => m.module_id),
    ['HAB-2'],
  );
  assert.equal((await request(app).get('/api/v1/habitat/status').set(as('bh'))).status, 403);
});

test('/me/readings pagina por cursor', async (t) => {
  if (skip(t)) return;
  const seen = [];
  let cursor = null;
  do {
    const res = await request(app)
      .get(`/api/v1/me/readings?code=SLEEP_HOURS&limit=3${cursor ? `&cursor=${cursor}` : ''}`)
      .set(as('orion'));
    assert.equal(res.status, 200);
    assert.ok(res.body.items.length <= 3);
    seen.push(...res.body.items.map((i) => i.id));
    cursor = res.body.next_cursor;
  } while (cursor);
  assert.equal(seen.length, 7);
  assert.equal(new Set(seen).size, 7, 'sin repetidos entre páginas');
  assert.equal(
    (await request(app).get('/api/v1/me/readings?cursor=basura').set(as('orion'))).status,
    400,
  );
  assert.equal(
    (await request(app).get('/api/v1/me/readings?code=WB_MOOD').set(as('orion'))).status,
    400,
  );
});

// 10 casos de test/catalog.test.js, ahora a través del endpoint: la evaluación del servidor
// debe ser idéntica a la del catálogo (mismo evaluador, mismas reglas activas).
const CATALOG_CASES = [
  ['BLOOD_PRESSURE', { systolic: 125, diastolic: 78 }, 'caution', 'self_care'],
  ['BLOOD_PRESSURE', { systolic: 88, diastolic: 58, symptoms: ['dizziness'] }, 'critical'],
  ['HEART_RATE', { value: 55, symptoms: ['fainting'] }, 'caution', 'crew'],
  ['HEART_RATE', { value: 150, at_rest: false }, 'unrated'],
  ['RESP_RATE', { value: 22 }, 'caution', 'crew'],
  ['SPO2', { value: 92 }, 'caution', 'crew'],
  ['BODY_TEMP', { value: 39.5 }, 'critical'],
  ['GLUCOSE', { value: 130, fasting: true }, 'caution', 'flight_surgeon'],
  [
    'VISION_CHECK',
    {
      near_blur: false,
      far_blur: false,
      amsler_distortion: true,
      blind_spot_or_field_loss: false,
      double_vision: false,
      transient_vision_loss: false,
      severe_headache: false,
    },
    'critical',
  ],
  ['SYMPTOM', { symptoms: ['cough', 'fever_feeling'] }, 'caution', 'crew'],
];

test('la evaluación del servidor coincide con la del catálogo (10 casos por el endpoint)', async (t) => {
  if (skip(t)) return;
  const { evaluateIndicator } = require('../src/engine/conditions');
  for (const [code, values, level, escalation] of CATALOG_CASES) {
    const res = await postReading('vega', code, values);
    assert.equal(res.status, 201, `${code} ${JSON.stringify(res.body)}`);
    const expected = evaluateIndicator(byCode[code], values);
    const server = { ...res.body.evaluation };
    const catalogResult = { ...expected };
    delete server.code;
    delete catalogResult.code;
    assert.deepEqual(server, catalogResult, `${code} ${JSON.stringify(values)}`);
    assert.equal(server.level, level, code);
    if (escalation) assert.equal(server.escalation, escalation, code);
  }
});
