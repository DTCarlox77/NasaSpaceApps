'use strict';
// Simulador (tarea 7) contra la base de PRUEBAS (DB_NAME_TEST): historia idempotente y sin
// críticos, escenarios con sus niveles y escalamientos, confidencialidad del bienestar y
// permisos de los endpoints (POST /admin/simulator/*) con SIMULATOR_ENABLED=true.
const { openTestDb, resetDatabase } = require('./helpers/db'); // antes que cualquier src/
process.env.RATE_LIMIT_LOGIN_PER_MINUTE = '1000';
process.env.SIMULATOR_ENABLED = 'true';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const ARES1 = '20000000-0000-4000-8000-000000000001';
const A = {
  orion: '10000000-0000-4000-8000-000000000011',
  vega: '10000000-0000-4000-8000-000000000012',
  lyra: '10000000-0000-4000-8000-000000000013',
  atlas: '10000000-0000-4000-8000-000000000014',
};

let db = null;
let SKIP_REASON = '';
let request = null;
let app = null;
const tokens = {};
let firstHistory = null;

before(async () => {
  const opened = await openTestDb();
  db = opened.db;
  SKIP_REASON = opened.reason;
  if (!db) return;
  await resetDatabase();
  request = require('supertest');
  app = require('../src/app');
  for (const [name, username] of Object.entries({
    admin: 'mission.control',
    reyes: 'dr.reyes',
    orion: 'a.ortega',
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
const q = async (sql, params) => (await db.pool.query(sql, params)).rows;
const post = (who, url, body = {}) => {
  const r = request(app).post(`/api/v1/admin/simulator${url}`);
  if (who) r.set('Authorization', `Bearer ${tokens[who]}`);
  return r.send(body);
};
const get = (who, url) =>
  request(app).get(`/api/v1${url}`).set('Authorization', `Bearer ${tokens[who]}`);
const counts = async () =>
  (
    await q(`SELECT (SELECT count(*) FROM readings)::int AS readings,
                    (SELECT count(*) FROM reading_evaluations)::int AS evaluations,
                    (SELECT count(*) FROM escalations)::int AS escalations,
                    (SELECT count(*) FROM wellbeing_checkins)::int AS checkins,
                    (SELECT count(*) FROM pvt_runs)::int AS pvt_runs,
                    (SELECT count(*) FROM instrument_administrations)::int AS instruments`)
  )[0];

/** Escalamientos de las lecturas creadas desde `since`. */
const escalationsSince = (since) =>
  q(
    `SELECT e.level::text AS level, e.is_confidential, e.category, r.indicator_code, e.astronaut_id
     FROM escalations e JOIN readings r ON r.id = e.source_id
     WHERE r.received_at >= $1 ORDER BY r.indicator_code`,
    [since],
  );

// ---------------------------------------------------------------- permisos

test('endpoints: 401 sin sesión, 403 para quien no es admin, 400 y 404 de validación', async (t) => {
  if (skip(t)) return;
  assert.equal((await post(null, '/history')).status, 401);
  for (const who of ['reyes', 'orion']) {
    const res = await post(who, '/history', { days: 1 });
    assert.equal(res.status, 403, who);
    assert.equal((await post(who, '/scenarios/co2_spike')).status, 403, who);
  }
  const bad = await post('admin', '/history', { days: 0, seed: -1 });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.error.details.map((d) => d.field).sort(), ['days', 'seed']);
  assert.equal((await post('admin', '/scenarios/meteor_shower')).status, 404);
  const badParams = await post('admin', '/scenarios/crew_illness', {
    astronaut: 'NOBODY',
    intensity: 'extreme',
  });
  assert.equal(badParams.status, 400);
  assert.deepEqual(badParams.body.error.details.map((d) => d.field).sort(), [
    'astronaut',
    'intensity',
  ]);
});

// ---------------------------------------------------------------- historia

test('historia: crea la historia completa, sin críticos ni escalamientos', async (t) => {
  if (skip(t)) return;
  const before = await counts();
  const res = await post('admin', '/history', { days: 14, seed: 42 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  firstHistory = res.body;
  assert.equal(res.body.kind, 'history');
  assert.deepEqual(res.body.params, { days: 14, seed: 42 });
  assert.equal(res.body.readings.rejected, 0, JSON.stringify(res.body.errors));
  assert.ok(res.body.readings.created > 2500);
  assert.equal(res.body.escalations.created, 0);
  assert.ok(res.body.wellbeing.checkins.created >= 13 * 4);
  assert.ok(res.body.wellbeing.pvt_runs.created >= 4 * 3 + 4);

  const after = await counts();
  assert.equal(after.readings - before.readings, res.body.readings.created);
  assert.equal(after.evaluations, after.readings, 'cada lectura tiene su evaluación');
  assert.equal(after.escalations, before.escalations, 'la historia normal no escala');

  const critical = await q(
    `SELECT count(*)::int AS n FROM reading_evaluations WHERE level = 'critical'`,
  );
  assert.equal(critical[0].n, 0);
  const synthetic = await q('SELECT count(*)::int AS n FROM readings WHERE NOT synthetic');
  assert.equal(synthetic[0].n, 0);
  const sources = await q(
    `SELECT DISTINCT source FROM readings WHERE module_id IS NOT NULL ORDER BY source`,
  );
  assert.deepEqual(
    sources.map((r) => r.source),
    ['simulator'],
  );

  // El resumen no informa niveles de bienestar (confidencial).
  assert.ok(!Object.keys(res.body.levels).some((c) => c.startsWith('WB_') || c.startsWith('PVT_')));
  assert.ok(res.body.levels.HAB_CO2.normal > 0);

  // Bienestar agrupado: cada check-in con sus 4 deslizadores y el sueño.
  const grouped = await q(
    `SELECT c.id, count(r.id)::int AS n FROM wellbeing_checkins c
     JOIN readings r ON r.wellbeing_checkin_id = c.id GROUP BY c.id`,
  );
  assert.ok(grouped.every((g) => g.n === 5));
  // La PVT semanal (con línea base) da aptitud; el dashboard la ve.
  const fit = await q(`SELECT DISTINCT ON (astronaut_id) fitness FROM pvt_runs
                       ORDER BY astronaut_id, measured_at DESC`);
  assert.ok(fit.every((r) => r.fitness === 'fit'));
});

test('historia: correrla otra vez no duplica (mismo conteo)', async (t) => {
  if (skip(t)) return;
  const before = await counts();
  // Con el mismo "ahora" que la primera carga: si no, un horario de la historia que cae justo
  // entre las dos (p. ej. la masa de las 06:50) agrega una lectura y la prueba falla según la hora.
  const { loadHistory } = require('../src/services/simulator.service');
  const body = await loadHistory({ body: { days: 14, seed: 42 }, now: new Date(firstHistory.to) });
  assert.equal(body.readings.created, 0);
  assert.equal(body.readings.duplicate, firstHistory.readings.created);
  assert.deepEqual(await counts(), before);
});

test('historia: los valores guardados son los del generador (misma semilla)', async (t) => {
  if (skip(t)) return;
  const { generateHistory } = require('../src/simulator/history');
  const [mission] = await q('SELECT starts_at FROM missions WHERE id = $1', [ARES1]);
  const crew = await q(
    'SELECT call_sign FROM v_current_crew WHERE mission_id = $1 ORDER BY call_sign',
    [ARES1],
  );
  const { items } = generateHistory({
    seed: 42,
    days: 14,
    now: new Date(firstHistory.to),
    missionStartsAt: mission.starts_at,
    crew,
  });
  const sample = items.filter((i) => i.type === 'reading').slice(0, 40);
  const rows = await q('SELECT client_uuid, components FROM readings WHERE client_uuid = ANY($1)', [
    sample.map((i) => i.client_uuid),
  ]);
  const byUuid = new Map(rows.map((r) => [r.client_uuid, r.components]));
  for (const item of sample) assert.deepEqual(byUuid.get(item.client_uuid), item.values);
});

// ---------------------------------------------------------------- escenarios

test('solar_event: RAD_DOSE_DAILY en caution y critical, con escalamientos', async (t) => {
  if (skip(t)) return;
  const since = new Date();
  const res = await post('admin', '/scenarios/solar_event', {
    intensity: 'high',
    astronaut: 'vega',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.params, { intensity: 'high', astronaut: 'VEGA' });
  const levels = res.body.levels.RAD_DOSE_DAILY;
  assert.ok(levels.caution > 0 && levels.critical > 0, JSON.stringify(levels));
  assert.ok(res.body.escalations.by_level.flight_surgeon > 0);
  assert.ok(res.body.escalations.by_level.crew > 0);
  const rows = await escalationsSince(since);
  assert.ok(rows.length > 0 && rows.every((r) => r.indicator_code === 'RAD_DOSE_DAILY'));
  // Náusea durante el evento: crítico por síntomas en VEGA.
  const vega = await q(
    `SELECT ev.level FROM readings r JOIN reading_evaluations ev ON ev.reading_id = r.id
     WHERE r.astronaut_id = $1 AND r.components->'symptoms' ? 'nausea'`,
    [A.vega],
  );
  assert.deepEqual(
    vega.map((r) => r.level),
    ['critical'],
  );
  // La acumulada de cada tripulante sube con la dosis del evento (antes se quedaba igual).
  const cum = await q(
    `SELECT r.astronaut_id, (r.components->>'value')::float8 AS value, r.measured_at
     FROM readings r WHERE r.indicator_code = 'RAD_DOSE_CUM' AND r.received_at >= $1`,
    [since],
  );
  assert.equal(cum.length, 4);
  for (const row of cum) {
    const [before] = await q(
      `SELECT (components->>'value')::float8 AS value FROM readings
       WHERE astronaut_id = $1 AND indicator_code = 'RAD_DOSE_CUM' AND received_at < $2
       ORDER BY measured_at DESC LIMIT 1`,
      [row.astronaut_id, since],
    );
    const [event] = await q(
      `SELECT sum((components->>'value')::float8) AS dose FROM readings
       WHERE astronaut_id = $1 AND indicator_code = 'RAD_DOSE_DAILY' AND received_at >= $2`,
      [row.astronaut_id, since],
    );
    assert.ok(Math.abs(row.value - (before.value + event.dose)) < 0.011, JSON.stringify(row));
  }
  assert.deepEqual(res.body.levels.RAD_DOSE_CUM, { normal: 4 });
});

test('crew_illness: BODY_TEMP en caution con escalamiento a crew', async (t) => {
  if (skip(t)) return;
  const since = new Date();
  const res = await post('admin', '/scenarios/crew_illness', { contagion: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.params.astronaut, 'LYRA');
  assert.ok(res.body.levels.BODY_TEMP.caution >= 2);
  const temps = (await escalationsSince(since)).filter((r) => r.indicator_code === 'BODY_TEMP');
  assert.ok(temps.length >= 2);
  assert.ok(temps.every((r) => r.level === 'crew' && !r.is_confidential));
  assert.equal(new Set(temps.map((r) => r.astronaut_id)).size, 2, 'contagio: dos tripulantes');
});

test('co2_spike: HAB_CO2 en caution (escala a crew) en el módulo elegido', async (t) => {
  if (skip(t)) return;
  const res = await post('admin', '/scenarios/co2_spike', { module_id: 'HAB-2' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.levels.HAB_CO2.caution > 0);
  assert.equal(res.body.levels.HAB_CO2.critical, undefined, 'low no llega a 10 mmHg');
  assert.ok(res.body.escalations.by_level.crew > 0);
  const status = await get('orion', '/habitat/status?module_id=HAB-2');
  assert.equal(status.status, 200);
  const co2 = status.body.modules[0].indicators.find((i) => i.code === 'HAB_CO2');
  assert.equal(co2.level, 'caution');
});

test('wellbeing_decline: escalamiento confidencial a behavioral_health, invisible para admin y el dashboard', async (t) => {
  if (skip(t)) return;
  const since = new Date();
  const res = await post('admin', '/scenarios/wellbeing_decline', { intensity: 'high' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.params.astronaut, 'ATLAS');
  assert.equal(res.body.readings.rejected, 0, JSON.stringify(res.body.errors));
  assert.ok(res.body.wellbeing.checkin_corrections >= 4 * 4, 'corrige los check-ins existentes');
  // El resumen que recibe admin no dice niveles ni escalamientos de bienestar.
  assert.deepEqual(res.body.levels, {});
  assert.equal(res.body.escalations.created, 0);
  const text = JSON.stringify(res.body);
  assert.ok(!/behavioral_health"\s*:/.test(text) && !/WB_|PHQ|GAD/.test(text));

  const rows = await escalationsSince(since);
  assert.ok(rows.length >= 4);
  assert.ok(
    rows.every(
      (r) =>
        r.level === 'behavioral_health' &&
        r.is_confidential &&
        r.category === 'behavioral' &&
        r.astronaut_id === A.atlas,
    ),
  );
  assert.ok(rows.some((r) => r.indicator_code.startsWith('WB_')));
  assert.ok(rows.some((r) => r.indicator_code === 'PHQ2_SCORE'));

  // Nunca a la tripulación ni a Tierra (bandeja y dashboard).
  const ids = (
    await q(`SELECT id FROM escalations WHERE is_confidential AND astronaut_id = $1`, [A.atlas])
  ).map((r) => r.id);
  for (const who of ['admin', 'reyes']) {
    const inbox = await get(who, '/admin/inbox?limit=100');
    assert.equal(inbox.status, 200);
    assert.ok(
      inbox.body.items.every((i) => !ids.includes(i.id)),
      who,
    );
    const dash = await get(who, '/admin/dashboard/crew');
    assert.equal(dash.status, 200);
    const body = JSON.stringify(dash.body);
    assert.ok(!/WB_|PHQ|GAD|PVT_/.test(body), who);
    for (const id of ids) assert.ok(!body.includes(id));
  }
  const crewSide = await q(
    `SELECT count(*)::int AS n FROM escalations
     WHERE astronaut_id = $1 AND category = 'behavioral' AND level <> 'behavioral_health'`,
    [A.atlas],
  );
  assert.equal(crewSide[0].n, 0);
});

test('dashboard: tras la historia muestra las series físicas y la aptitud', async (t) => {
  if (skip(t)) return;
  const dash = await get('reyes', '/admin/dashboard/crew');
  assert.equal(dash.status, 200);
  const orion = dash.body.astronauts.find((a) => a.call_sign === 'ORION');
  const codes = orion.indicators.map((i) => i.code);
  for (const code of ['BLOOD_PRESSURE', 'HEART_RATE', 'SPO2', 'RAD_DOSE_DAILY']) {
    assert.ok(codes.includes(code), code);
  }
  const bp = orion.indicators.find((i) => i.code === 'BLOOD_PRESSURE');
  assert.equal(bp.series.length, 10);
  assert.notEqual(bp.trend, 'insufficient_data');
  // Aptitud para tarea crítica (tarea 10): la de una PVT de las últimas 12 h; la historia hace
  // la PVT semanal, así que sin una reciente es not_confirmed.
  const [recent] = await q(
    `SELECT fitness FROM pvt_runs WHERE astronaut_id = $1 AND measured_at >= now() - interval '12 hours'
     ORDER BY measured_at DESC LIMIT 1`,
    [A.orion],
  );
  assert.equal(orion.fitness, recent ? recent.fitness : 'not_confirmed');
  assert.equal(orion.compliance, null);
});
