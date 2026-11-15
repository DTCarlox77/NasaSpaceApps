'use strict';
// Integración de la tarea 6: escalamiento con retraso, bandeja de Tierra, acuse, mensajes,
// dashboard de tripulación, administración de la misión y cortes de enlace.
// El paso del tiempo se simula moviendo created_at / deliver_at hacia atrás (sin sleeps).
// Usa la base de PRUEBAS (DB_NAME_TEST), reiniciada al empezar la suite bajo el advisory lock.
const { openTestDb, resetDatabase } = require('./helpers/db'); // antes que cualquier src/
process.env.RATE_LIMIT_LOGIN_PER_MINUTE = '1000';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const ARES1 = '20000000-0000-4000-8000-000000000001';
const A = {
  orion: '10000000-0000-4000-8000-000000000011',
  vega: '10000000-0000-4000-8000-000000000012',
  lyra: '10000000-0000-4000-8000-000000000013',
  atlas: '10000000-0000-4000-8000-000000000014',
};
const U = {
  admin: '00000000-0000-4000-8000-000000000001',
  reyes: '00000000-0000-4000-8000-000000000002',
  orion: '00000000-0000-4000-8000-000000000011',
};
const DELAY = 90; // mars_transit (seed)

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
    admin: 'mission.control',
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
const q = async (sql, params) => (await db.pool.query(sql, params)).rows;
const api = (who, method, url, body) => {
  const r = request(app)[method](`/api/v1${url}`).set(as(who));
  return body === undefined ? r : r.send(body);
};

function postReading(who, code, values, extra = {}) {
  return api(who, 'post', '/readings', {
    client_uuid: crypto.randomUUID(),
    indicator_code: code,
    measured_at: new Date().toISOString(),
    values,
    input_method: 'manual',
    ...extra,
  });
}

/** "Pasa el tiempo": mueve el envío y la entrega `seconds` hacia atrás. */
async function travel(table, id, seconds) {
  await q(
    `UPDATE ${table} SET created_at = created_at - make_interval(secs => $2),
                         deliver_at = deliver_at - make_interval(secs => $2)
     WHERE id = $1`,
    [id, seconds],
  );
}

const inbox = async (who, query = '') => {
  const res = await api(who, 'get', `/admin/inbox${query}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
};
const inboxIds = async (who, query) => (await inbox(who, query)).items.map((i) => i.id);

/** Lectura crítica de ORION; devuelve { readingId, groundId, crewId }. */
async function criticalReading() {
  const res = await postReading('orion', 'BLOOD_PRESSURE', { systolic: 185, diastolic: 100 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const rows = await q('SELECT id, level FROM escalations WHERE source_id = $1', [
    res.body.reading.id,
  ]);
  return {
    readingId: res.body.reading.id,
    groundId: res.body.escalation_id,
    crewId: rows.find((r) => r.level === 'crew').id,
  };
}

/** Lectura confidencial insertada directamente (los endpoints /wellbeing son la tarea 10). */
async function confidentialReading(code, components) {
  const [row] = await q(
    `INSERT INTO readings (client_uuid, recorded_by, mission_id, astronaut_id, indicator_code,
                           components, source, measured_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'slider', now()) RETURNING *`,
    [crypto.randomUUID(), U.orion, ARES1, A.orion, code, components],
  );
  return row;
}

// ---------------------------------------------------------------- escalamiento

test('lectura crítica: escalamiento a crew (a bordo) y a flight_surgeon (con retraso)', async (t) => {
  if (skip(t)) return;
  const { readingId, groundId } = await criticalReading();
  const rows = await q(
    `SELECT id, level, priority, status, category, is_confidential,
            extract(epoch FROM deliver_at - created_at)::int AS delay
     FROM escalations WHERE source_id = $1 ORDER BY level`,
    [readingId],
  );
  assert.deepEqual(
    rows.map(({ id: _id, ...r }) => r),
    [
      {
        level: 'crew',
        priority: 'urgent',
        status: 'delivered',
        category: 'physical',
        is_confidential: false,
        delay: 0,
      },
      {
        level: 'flight_surgeon',
        priority: 'urgent',
        status: 'queued',
        category: 'physical',
        is_confidential: false,
        delay: DELAY,
      },
    ],
  );
  assert.equal(rows[1].id, groundId);
});

test('una lectura en caution escala con prioridad routine y sin aviso a bordo', async (t) => {
  if (skip(t)) return;
  const res = await postReading('orion', 'BLOOD_PRESSURE', { systolic: 145, diastolic: 88 });
  assert.equal(res.status, 201);
  assert.equal(res.body.evaluation.level, 'caution');
  const rows = await q('SELECT level, priority FROM escalations WHERE source_id = $1', [
    res.body.reading.id,
  ]);
  assert.deepEqual(rows, [{ level: 'flight_surgeon', priority: 'routine' }]);
});

test('idempotencia: reevaluar la misma lectura no duplica escalamientos', async (t) => {
  if (skip(t)) return;
  const { readingId, groundId } = await criticalReading();
  const { escalateReading } = require('../src/services/escalation.service');
  const [reading] = await q('SELECT * FROM readings WHERE id = $1', [readingId]);
  const again = await escalateReading(
    {
      reading,
      indicator: { code: 'BLOOD_PRESSURE', sensitivity: 'standard', unit: 'mmHg' },
      evaluation: { level: 'critical', escalation: 'flight_surgeon' },
    },
    db.pool,
  );
  assert.equal(again, groundId);
  const [{ n }] = await q('SELECT count(*)::int AS n FROM escalations WHERE source_id = $1', [
    readingId,
  ]);
  assert.equal(n, 2);
});

// ---------------------------------------------------------------- bandeja y acuse

test('el flight surgeon no ve la alerta antes de deliver_at y sí después', async (t) => {
  if (skip(t)) return;
  const { groundId, crewId } = await criticalReading();
  assert.ok(!(await inboxIds('reyes')).includes(groundId), 'todavía en camino');

  await travel('escalations', groundId, DELAY + 1);
  const page = await inbox('reyes');
  const item = page.items.find((i) => i.id === groundId);
  assert.ok(item, 'ya llegó a Tierra');
  assert.equal(item.status, 'delivered');
  assert.equal(item.category, 'reading');
  assert.equal(item.source_type, 'reading');
  assert.equal(item.call_sign, 'ORION');
  assert.equal(item.mission_code, 'ARES-1');
  assert.equal(item.evaluation.code, 'BLOOD_PRESSURE');
  assert.equal(item.evaluation.level, 'critical');
  assert.ok(!page.items.some((i) => i.id === crewId), 'lo de a bordo no va a la bandeja');
  const [{ status }] = await q('SELECT status FROM escalations WHERE id = $1', [groundId]);
  assert.equal(status, 'delivered', 'queued → delivered al leer la bandeja');

  // Filtros del contrato.
  assert.ok((await inboxIds('reyes', '?category=reading')).includes(groundId));
  assert.ok(!(await inboxIds('reyes', '?category=emergency')).includes(groundId));
  assert.ok(!(await inboxIds('reyes', '?status=acknowledged')).includes(groundId));
  assert.ok((await inboxIds('admin', `?mission_id=${ARES1}`)).includes(groundId));
  assert.equal((await api('reyes', 'get', '/admin/inbox?category=otro')).status, 400);
  assert.equal((await api('orion', 'get', '/admin/inbox')).status, 403);
});

test('bandeja ordenada por prioridad y paginada por cursor', async (t) => {
  if (skip(t)) return;
  const all = (await inbox('reyes', '?limit=200')).items;
  const rank = { emergency: 0, urgent: 1, routine: 2 };
  for (let i = 1; i < all.length; i += 1) {
    assert.ok(rank[all[i - 1].priority] <= rank[all[i].priority], 'prioridad');
  }
  const seen = [];
  let cursor = null;
  do {
    const page = await inbox('reyes', `?limit=1${cursor ? `&cursor=${cursor}` : ''}`);
    seen.push(...page.items.map((i) => i.id));
    cursor = page.next_cursor;
  } while (cursor);
  assert.deepEqual(
    seen,
    all.map((i) => i.id),
  );
  assert.equal((await api('reyes', 'get', '/admin/inbox?cursor=xx')).status, 400);
});

test('acuse: 404 antes de llegar; luego acknowledged e idempotente', async (t) => {
  if (skip(t)) return;
  const { groundId, crewId } = await criticalReading();
  const early = await api('reyes', 'post', `/admin/escalations/${groundId}/ack`);
  assert.equal(early.status, 404);
  assert.equal((await api('reyes', 'post', `/admin/escalations/${crewId}/ack`)).status, 404);

  await travel('escalations', groundId, DELAY + 1);
  const ack = await api('reyes', 'post', `/admin/escalations/${groundId}/ack`);
  assert.equal(ack.status, 200, JSON.stringify(ack.body));
  assert.equal(ack.body.status, 'acknowledged');
  assert.equal(ack.body.acknowledged_by, U.reyes);
  assert.ok(ack.body.acknowledged_at);

  const again = await api('admin', 'post', `/admin/escalations/${groundId}/ack`);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, ack.body, 'el segundo acuse conserva el primero');
  assert.ok((await inboxIds('reyes', '?status=acknowledged')).includes(groundId));

  await q("UPDATE escalations SET status = 'closed', closed_at = now() WHERE id = $1", [groundId]);
  const closed = await api('reyes', 'post', `/admin/escalations/${groundId}/ack`);
  assert.equal(closed.status, 409, 'cerrado: choca con el estado (CONFLICT)');
  assert.equal(closed.body.error.code, 'CONFLICT');
  assert.ok(!(await inboxIds('reyes', '?limit=200')).includes(groundId), 'sale de la bandeja');
  assert.equal(
    (await api('reyes', 'post', `/admin/escalations/${crypto.randomUUID()}/ack`)).status,
    404,
  );
  assert.equal((await api('reyes', 'post', '/admin/escalations/no-uuid/ack')).status, 400);
});

// ---------------------------------------------------------------- mensajes con retraso

test('respuesta de Tierra con retraso: el astronauta la ve solo cuando se entrega', async (t) => {
  if (skip(t)) return;
  const { groundId } = await criticalReading();
  await travel('escalations', groundId, DELAY + 1);

  const sent = await api('reyes', 'post', `/admin/escalations/${groundId}/messages`, {
    body: 'Recibido. Reposo y repetir la presión en 5 minutos.',
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.direction, 'to_crew');
  assert.equal(sent.body.author_role, 'flight_surgeon');
  assert.equal(sent.body.author_id, U.reyes);
  assert.equal((Date.parse(sent.body.deliver_at) - Date.parse(sent.body.created_at)) / 1000, DELAY);
  const [esc] = await q('SELECT status, acknowledged_by FROM escalations WHERE id = $1', [
    groundId,
  ]);
  assert.deepEqual(esc, { status: 'responded', acknowledged_by: U.reyes });

  const before = await api('orion', 'get', `/escalations/${groundId}/messages`);
  assert.equal(before.status, 200);
  assert.deepEqual(before.body, { items: [], next_cursor: null }, 'todavía en camino');

  await travel('escalation_messages', sent.body.id, DELAY + 1);
  const afterDelivery = await api('orion', 'get', `/escalations/${groundId}/messages`);
  assert.equal(afterDelivery.status, 200);
  assert.equal(afterDelivery.body.items.length, 1);
  assert.equal(afterDelivery.body.items[0].body, sent.body.body);

  // CMO: ve lo físico de la tripulación; otro tripulante, no.
  assert.equal((await api('vega', 'get', `/escalations/${groundId}/messages`)).status, 200);
  assert.equal((await api('lyra', 'get', `/escalations/${groundId}/messages`)).status, 403);
  assert.equal((await api('reyes', 'get', `/escalations/${groundId}/messages`)).status, 403);

  assert.equal(
    (await api('reyes', 'post', `/admin/escalations/${groundId}/messages`, { body: '' })).status,
    400,
  );
  assert.ok((await inboxIds('reyes', '?status=responded')).includes(groundId));
});

// ---------------------------------------------------------------- confidencialidad

test('conductual: solo behavioral_health; ni admin ni el flight surgeon lo ven', async (t) => {
  if (skip(t)) return;
  const { escalateReading } = require('../src/services/escalation.service');
  const reading = await confidentialReading('WB_MOOD', { value: 2 });
  const id = await escalateReading(
    {
      reading,
      indicator: { code: 'WB_MOOD', sensitivity: 'confidential', unit: '1-10' },
      evaluation: { level: 'caution', escalation: 'behavioral_health' },
    },
    db.pool,
  );
  const rows = await q(
    `SELECT level, category, source_type, is_confidential, status, reason,
            extract(epoch FROM deliver_at - created_at)::int AS delay
     FROM escalations WHERE source_id = $1`,
    [reading.id],
  );
  assert.deepEqual(rows, [
    {
      level: 'behavioral_health',
      category: 'behavioral',
      source_type: 'wellbeing',
      is_confidential: true,
      status: 'queued',
      reason: 'WB_MOOD en caution: alerta de bienestar.',
      delay: DELAY,
    },
  ]);
  assert.ok(!rows[0].reason.includes('2'), 'la razón no lleva el valor');

  await travel('escalations', id, DELAY + 1);
  for (const who of ['admin', 'reyes']) {
    const items = (await inbox(who, '?limit=200')).items;
    assert.ok(!items.some((i) => i.id === id), `${who} no ve lo confidencial`);
    assert.ok(!items.some((i) => i.category === 'wellbeing' && who === 'admin'));
    assert.equal((await api(who, 'post', `/admin/escalations/${id}/ack`)).status, 404);
  }
  assert.equal((await api('orion', 'get', `/escalations/${id}/messages`)).status, 200);
  assert.equal((await api('vega', 'get', `/escalations/${id}/messages`)).status, 403);
  assert.equal((await api('lyra', 'get', `/escalations/${id}/messages`)).status, 403);
});

test('alerta de bienestar escalada (solo estado): la ve el flight surgeon, no admin', async (t) => {
  if (skip(t)) return;
  const [alert] = await q(
    `INSERT INTO escalations (mission_id, astronaut_id, source_type, level, priority, status,
                              reason, created_at, deliver_at)
     VALUES ($1, $2, 'wellbeing', 'flight_surgeon', 'routine', 'queued',
             'Alerta de bienestar escalada (solo estado).', now() - interval '5 minutes',
             now() - interval '1 minute')
     RETURNING id, category, is_confidential`,
    [ARES1, A.lyra],
  );
  assert.equal(alert.category, 'behavioral');
  assert.equal(alert.is_confidential, false);

  const fs = await inbox('reyes', '?category=wellbeing');
  assert.deepEqual(
    fs.items.map((i) => [i.id, i.category, i.source_type]),
    [[alert.id, 'wellbeing', 'wellbeing']],
  );
  assert.ok(!(await inboxIds('admin', '?limit=200')).includes(alert.id));
  assert.deepEqual((await inbox('admin', '?category=wellbeing')).items, []);
  assert.equal((await api('admin', 'post', `/admin/escalations/${alert.id}/ack`)).status, 403);
  assert.equal((await api('reyes', 'post', `/admin/escalations/${alert.id}/ack`)).status, 200);
});

test('behavioral_health no ve el dashboard físico ni la bandeja de Tierra', async (t) => {
  if (skip(t)) return;
  assert.equal((await api('bh', 'get', '/admin/dashboard/crew')).status, 403);
  assert.equal((await api('bh', 'get', '/admin/inbox')).status, 403);
  assert.equal((await api('orion', 'get', '/admin/dashboard/crew')).status, 403);
});

// ---------------------------------------------------------------- dashboard

test('dashboard: semáforo físico con tendencia y sin datos confidenciales', async (t) => {
  if (skip(t)) return;
  await postReading('lyra', 'SPO2', { value: 98 });
  await postReading('lyra', 'SPO2', { value: 97 });
  await postReading('lyra', 'SPO2', { value: 88 });
  await confidentialReading('WB_STRESS', { value: 9 });
  await q(
    `INSERT INTO pvt_runs (client_uuid, astronaut_id, device_id, fitness, measured_at)
     VALUES ($1, $2, 'tab-test', 'fit', now())`,
    [crypto.randomUUID(), A.orion],
  );
  await q(
    `INSERT INTO wellbeing_checkins (client_uuid, astronaut_id, measured_at)
     VALUES ($1, $2, now()), ($3, $2, now() - interval '1 day')`,
    [crypto.randomUUID(), A.orion, crypto.randomUUID()],
  );

  const res = await api('reyes', 'get', '/admin/dashboard/crew');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.mission_id, ARES1);
  assert.equal(res.body.mission_code, 'ARES-1');
  assert.deepEqual(res.body.astronauts.map((a) => a.call_sign).sort(), [
    'ATLAS',
    'LYRA',
    'ORION',
    'VEGA',
  ]);

  const lyra = res.body.astronauts.find((a) => a.call_sign === 'LYRA');
  const spo2 = lyra.indicators.find((i) => i.code === 'SPO2');
  assert.equal(spo2.level, 'critical');
  assert.equal(lyra.worst_level, 'critical');
  assert.equal(spo2.trend, 'falling');
  assert.deepEqual(
    spo2.series.map((p) => p.value),
    [98, 97, 88],
  );
  assert.deepEqual(spo2.last_value, { value: 88 });

  const orion = res.body.astronauts.find((a) => a.call_sign === 'ORION');
  const bp = orion.indicators.find((i) => i.code === 'BLOOD_PRESSURE');
  assert.equal(bp.level, 'critical');
  assert.equal(bp.series[bp.series.length - 1].value, 185);

  // Nada confidencial: ni indicadores de bienestar ni agregados para el flight surgeon.
  const confidential = new Set(
    (await q("SELECT code FROM indicators WHERE sensitivity = 'confidential'")).map((r) => r.code),
  );
  const codes = res.body.astronauts.flatMap((a) => a.indicators.map((i) => i.code));
  assert.ok(codes.length > 0);
  assert.ok(
    codes.every((c) => !confidential.has(c)),
    codes.join(','),
  );
  assert.ok(!JSON.stringify(res.body).includes('WB_'));
  for (const a of res.body.astronauts) {
    assert.equal(a.compliance, null, 'el flight surgeon no ve cumplimiento');
    assert.equal(a.fitness, null, 'ni aptitud');
  }

  // admin: cumplimiento y aptitud (lo único de bienestar que la matriz le permite).
  const admin = await api('admin', 'get', `/admin/dashboard/crew?mission_id=${ARES1}`);
  assert.equal(admin.status, 200);
  const orionAdmin = admin.body.astronauts.find((a) => a.call_sign === 'ORION');
  assert.equal(orionAdmin.fitness, 'fit');
  assert.equal(orionAdmin.compliance.checkins_expected_7d, 7);
  assert.ok(orionAdmin.compliance.checkins_completed_7d >= 2);
  assert.equal(admin.body.astronauts.find((a) => a.call_sign === 'VEGA').fitness, 'not_confirmed');
  assert.ok(
    admin.body.astronauts
      .flatMap((a) => a.indicators.map((i) => i.code))
      .every((c) => !confidential.has(c)),
  );

  assert.equal(
    (await api('reyes', 'get', `/admin/dashboard/crew?mission_id=${crypto.randomUUID()}`)).status,
    404,
  );
});

// ---------------------------------------------------------------- administración de la misión

test('misiones y entornos: alta, lista, cambio y 409', async (t) => {
  if (skip(t)) return;
  const env = await api('admin', 'post', '/admin/environments', {
    code: 'test_orbit',
    name: 'Órbita de prueba',
    type: 'space_station',
    gravity_g: 0,
    comm_delay_seconds: 2,
  });
  assert.equal(env.status, 201, JSON.stringify(env.body));
  assert.equal(env.body.description, null);
  assert.equal(
    (await api('admin', 'post', '/admin/environments', { ...env.body, updated_at: undefined }))
      .status,
    409,
  );
  const patched = await api('admin', 'patch', '/admin/environments/test_orbit', {
    comm_delay_seconds: 4,
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.comm_delay_seconds, 4);
  assert.equal(
    (await api('admin', 'patch', '/admin/environments/nope', { name: 'x' })).status,
    404,
  );
  assert.equal((await api('admin', 'patch', '/admin/environments/test_orbit', {})).status, 400);
  const envs = await api('admin', 'get', '/admin/environments?limit=2');
  assert.equal(envs.body.items.length, 2);
  assert.ok(envs.body.next_cursor);

  const created = await api('admin', 'post', '/admin/missions', {
    code: 'TEST-1',
    name: 'Misión de prueba',
    environment_code: 'test_orbit',
    starts_at: '2026-12-01T00:00:00Z',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.status, 'planned');
  const [member] = await q(
    'SELECT function FROM mission_ground_team WHERE mission_id = $1 AND user_id = $2',
    [created.body.id, U.admin],
  );
  assert.deepEqual(member, { function: 'operations' }, 'el admin que la crea entra al equipo');

  const dup = await api('admin', 'post', '/admin/missions', {
    code: 'TEST-1',
    name: 'Otra',
    environment_code: 'test_orbit',
    starts_at: '2026-12-01T00:00:00Z',
  });
  assert.equal(dup.status, 409);
  const bad = await api('admin', 'post', '/admin/missions', {
    code: 'TEST-2',
    name: 'Mala',
    environment_code: 'no_existe',
    starts_at: '2026-12-01T00:00:00Z',
    ends_at: '2026-11-01T00:00:00Z',
  });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.error.details.map((d) => d.field).sort(), [
    'ends_at',
    'environment_code',
  ]);

  const upd = await api('admin', 'patch', `/admin/missions/${created.body.id}`, {
    status: 'active',
    ends_at: '2027-01-01T00:00:00Z',
  });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.status, 'active');
  assert.equal(
    (
      await api('admin', 'patch', `/admin/missions/${created.body.id}`, {
        ends_at: '2026-01-01T00:00:00Z',
      })
    ).status,
    400,
  );
  const active = await api('admin', 'get', '/admin/missions?status=active');
  assert.deepEqual(active.body.items.map((m) => m.code).sort(), ['ARES-1', 'TEST-1']);

  for (const [method, url] of [
    ['get', '/admin/missions'],
    ['get', '/admin/environments'],
    ['get', '/admin/assignments'],
    ['get', '/admin/comm-outages'],
  ]) {
    assert.equal((await api('reyes', method, url)).status, 403, url);
  }
});

test('asignaciones: lista vigente, solapes (409) y fin futuro', async (t) => {
  if (skip(t)) return;
  const list = await api('admin', 'get', `/admin/assignments?mission_id=${ARES1}&active=true`);
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 4);
  const atlas = list.body.items.find((a) => a.call_sign === 'ATLAS');

  const overlap = await api('admin', 'post', '/admin/assignments', {
    mission_id: ARES1,
    astronaut_id: A.atlas,
    crew_role: 'pilot',
  });
  assert.equal(overlap.status, 409);
  assert.equal(overlap.body.error.code, 'ASSIGNMENT_OVERLAP');
  assert.equal(overlap.body.error.details.conflicting_assignment_id, atlas.id);

  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const ended = await api('admin', 'patch', `/admin/assignments/${atlas.id}`, {
    assigned_to: future,
  });
  assert.equal(ended.status, 200, JSON.stringify(ended.body));
  assert.equal(new Date(ended.body.assigned_to).toISOString(), future);
  assert.equal(
    (await api('admin', 'get', `/admin/assignments?mission_id=${ARES1}&active=true`)).body.items
      .length,
    4,
    'un fin futuro sigue vigente',
  );

  const takenRole = await api('admin', 'patch', `/admin/assignments/${atlas.id}`, {
    crew_role: 'commander',
  });
  assert.equal(takenRole.status, 409);
  assert.equal(takenRole.body.error.code, 'CREW_ROLE_TAKEN');

  const before = await api('admin', 'patch', `/admin/assignments/${atlas.id}`, {
    assigned_to: '2020-01-01T00:00:00Z',
  });
  assert.equal(before.status, 400);
  assert.equal(
    (
      await api('admin', 'post', '/admin/assignments', {
        mission_id: ARES1,
        astronaut_id: crypto.randomUUID(),
        crew_role: 'pilot',
      })
    ).status,
    400,
  );
});

// ---------------------------------------------------------------- cortes de enlace

test('corte abierto → deliver_at NULL; al cerrarlo se recalcula', async (t) => {
  if (skip(t)) return;
  const { groundId: delivered } = await criticalReading();
  await travel('escalations', delivered, DELAY + 1);

  const outage = await api('admin', 'post', '/admin/comm-outages', {
    mission_id: ARES1,
    starts_at: new Date(Date.now() - 60 * 1000).toISOString(),
    reason: 'Antena en mantenimiento (prueba)',
  });
  assert.equal(outage.status, 201, JSON.stringify(outage.body));
  assert.equal(outage.body.ends_at, null);

  const overlap = await api('admin', 'post', '/admin/comm-outages', {
    mission_id: ARES1,
    starts_at: new Date(Date.now() - 30 * 1000).toISOString(),
    ends_at: new Date(Date.now() + 60 * 1000).toISOString(),
    reason: 'Solapado',
  });
  assert.equal(overlap.status, 409);
  assert.equal(overlap.body.error.code, 'OUTAGE_OVERLAP');
  assert.equal(overlap.body.error.details.conflicting_outage_id, outage.body.id);

  // Durante el corte: la alerta nueva queda en cola y la respuesta de Tierra también.
  const { groundId: queued, crewId } = await criticalReading();
  const [q1] = await q('SELECT deliver_at, status FROM escalations WHERE id = $1', [queued]);
  assert.deepEqual(q1, { deliver_at: null, status: 'queued' });
  const [onBoard] = await q('SELECT status FROM escalations WHERE id = $1', [crewId]);
  assert.equal(onBoard.status, 'delivered', 'a bordo no depende del enlace');
  assert.ok(!(await inboxIds('reyes', '?limit=200')).includes(queued));

  const reply = await api('reyes', 'post', `/admin/escalations/${delivered}/messages`, {
    body: 'Seguimos atentos.',
  });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.deliver_at, null, 'en cola esperando enlace');

  // Cierra el corte: lo que estaba en cola sale cuando vuelve el enlace + retraso.
  const endsAt = new Date().toISOString();
  const closed = await api('admin', 'patch', `/admin/comm-outages/${outage.body.id}`, {
    ends_at: endsAt,
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  const [e] = await q(
    'SELECT extract(epoch FROM deliver_at - $2::timestamptz)::int AS after_end FROM escalations WHERE id = $1',
    [queued, endsAt],
  );
  assert.equal(e.after_end, DELAY);
  const [m] = await q(
    `SELECT extract(epoch FROM deliver_at - $2::timestamptz)::int AS after_end
     FROM escalation_messages WHERE id = $1`,
    [reply.body.id, endsAt],
  );
  assert.equal(m.after_end, DELAY);

  const list = await api('admin', 'get', `/admin/comm-outages?mission_id=${ARES1}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.items[0].id, outage.body.id);
});

test('corte programado retrasa la entrega; acortarlo la adelanta', async (t) => {
  if (skip(t)) return;
  const [last] = await q(
    'SELECT ends_at FROM mission_comm_outages WHERE mission_id = $1 ORDER BY ends_at DESC LIMIT 1',
    [ARES1],
  );
  const startsAt = new Date(last.ends_at).toISOString();
  const endsAt = new Date(Date.now() + 3600 * 1000).toISOString();
  const outage = await api('admin', 'post', '/admin/comm-outages', {
    mission_id: ARES1,
    starts_at: startsAt,
    ends_at: endsAt,
    reason: 'Conjunción solar (prueba)',
  });
  assert.equal(outage.status, 201, JSON.stringify(outage.body));

  const { groundId } = await criticalReading();
  const delayAfter = async (end) =>
    (
      await q(
        `SELECT extract(epoch FROM deliver_at - $2::timestamptz)::int AS s
         FROM escalations WHERE id = $1`,
        [groundId, end],
      )
    )[0].s;
  assert.equal(await delayAfter(endsAt), DELAY, 'sale al terminar el corte');

  const earlier = new Date(Date.now() + 600 * 1000).toISOString();
  const res = await api('admin', 'patch', `/admin/comm-outages/${outage.body.id}`, {
    ends_at: earlier,
  });
  assert.equal(res.status, 200);
  assert.equal(await delayAfter(earlier), DELAY, 'en camino: se recalcula con el fin nuevo');

  // Deja el enlace libre para el resto (fin = ahora).
  const now = new Date().toISOString();
  assert.equal(
    (await api('admin', 'patch', `/admin/comm-outages/${outage.body.id}`, { ends_at: now })).status,
    200,
  );
  assert.equal(await delayAfter(now), DELAY);
  assert.equal(
    (
      await api('admin', 'patch', `/admin/comm-outages/${outage.body.id}`, {
        ends_at: '2000-01-01T00:00:00Z',
      })
    ).status,
    400,
  );
});
