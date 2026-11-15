'use strict';
// Sexo biológico del perfil (migración 009) contra la base de PRUEBAS: alta y PATCH con
// validación, quién lo recibe (astronauta propio, flight_surgeon y behavioral_health; nunca
// admin, otro astronauta ni el dashboard) y su uso en el contexto de evaluación.
const { openTestDb, resetDatabase } = require('./helpers/db'); // antes que cualquier src/
process.env.RATE_LIMIT_LOGIN_PER_MINUTE = '1000';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const ARES1 = '20000000-0000-4000-8000-000000000001';
const A = {
  orion: '10000000-0000-4000-8000-000000000011',
  vega: '10000000-0000-4000-8000-000000000012',
  lyra: '10000000-0000-4000-8000-000000000013',
};

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
    admin: 'mission.control',
    reyes: 'dr.reyes',
    salas: 'bh.salas',
    orion: 'a.ortega',
    vega: 'k.mensah',
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
const as = (who, method, url) =>
  request(app)[method](`/api/v1${url}`).set('Authorization', `Bearer ${tokens[who]}`);
const hasSex = (body) => JSON.stringify(body).includes('"sex"');

test('seed: los 4 tripulantes de ARES-1 tienen sexo sintético', async (t) => {
  if (skip(t)) return;
  const rows = await q(
    `SELECT a.call_sign, a.sex, a.synthetic FROM v_current_crew c
     JOIN astronauts a ON a.id = c.astronaut_id WHERE c.mission_id = $1 ORDER BY a.call_sign`,
    [ARES1],
  );
  assert.deepEqual(
    rows.map((r) => [r.call_sign, r.sex, r.synthetic]),
    [
      ['ATLAS', 'male', true],
      ['LYRA', 'female', true],
      ['ORION', 'female', true],
      ['VEGA', 'male', true],
    ],
  );
});

test('alta: sex opcional, solo female o male; admin no lo recibe', async (t) => {
  if (skip(t)) return;
  const body = (sex, n) => ({
    username: `test.sex${n}`,
    full_name: `Prueba ${n} (sintética)`,
    role: 'astronaut',
    astronaut: { call_sign: `SEX${n}`, mission_id: ARES1, crew_role: 'mission_specialist', sex },
  });
  for (const bad of ['other', 'F', 1, '']) {
    const res = await as('admin', 'post', '/admin/users').send(body(bad, 9));
    assert.equal(res.status, 400, String(bad));
    assert.ok(res.body.error.details.some((d) => d.field === 'astronaut.sex'));
  }
  const res = await as('admin', 'post', '/admin/users').send(body('female', 1));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(hasSex(res.body), false);
  const [row] = await q('SELECT sex FROM astronauts WHERE id = $1', [res.body.astronaut.id]);
  assert.equal(row.sex, 'female');
  // Sin sex: queda null.
  const none = await as('admin', 'post', '/admin/users').send({
    ...body(undefined, 2),
    astronaut: { call_sign: 'SEX2', mission_id: ARES1, crew_role: 'flight_engineer' },
  });
  assert.equal(none.status, 201, JSON.stringify(none.body));
  const [nullRow] = await q('SELECT sex FROM astronauts WHERE id = $1', [none.body.astronaut.id]);
  assert.equal(nullRow.sex, null);
});

test('PATCH /admin/astronauts/{id}: valida, no devuelve sex y solo lo usa admin', async (t) => {
  if (skip(t)) return;
  const patch = (who, id, body) => as(who, 'patch', `/admin/astronauts/${id}`).send(body);
  for (const bad of [{ sex: 'x' }, { sex: 0 }, {}, { call_sign: 'NOPE' }]) {
    const res = await patch('admin', A.lyra, bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
  assert.equal((await patch('reyes', A.lyra, { sex: 'male' })).status, 403);
  assert.equal((await patch('orion', A.orion, { sex: 'male' })).status, 403);
  assert.equal((await patch('admin', randomUUID(), { sex: 'male' })).status, 404);

  const res = await patch('admin', A.lyra, { sex: null });
  assert.equal(res.status, 200);
  assert.equal(res.body.id, A.lyra);
  assert.equal(hasSex(res.body), false);
  assert.equal((await q('SELECT sex FROM astronauts WHERE id = $1', [A.lyra]))[0].sex, null);
  const back = await patch('admin', A.lyra, { sex: 'female' });
  assert.equal(back.status, 200);
  assert.equal(hasSex(back.body), false);
  assert.equal((await q('SELECT sex FROM astronauts WHERE id = $1', [A.lyra]))[0].sex, 'female');
});

test('visibilidad: el astronauta ve el suyo; el equipo clínico lo ve; admin y otros no', async (t) => {
  if (skip(t)) return;
  const me = await as('orion', 'get', '/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.context.sex, 'female');
  const groundMe = await as('reyes', 'get', '/me');
  assert.equal(hasSex(groundMe.body), false);

  const crew = async (who) => {
    const res = await as(who, 'get', `/missions/${ARES1}/crew`);
    assert.equal(res.status, 200, `${who}: ${JSON.stringify(res.body)}`);
    return new Map(res.body.items.map((i) => [i.astronaut_id, i]));
  };
  for (const who of ['reyes', 'salas']) {
    const items = await crew(who);
    assert.equal(items.get(A.orion).sex, 'female', who);
    assert.equal(items.get(A.vega).sex, 'male', who);
  }
  const forAdmin = await crew('admin');
  assert.ok(forAdmin.size >= 4);
  assert.equal(
    [...forAdmin.values()].some((i) => 'sex' in i),
    false,
  );
  // Otro astronauta (VEGA es el CMO): ve la tripulación, no el sexo de los demás.
  const forVega = await crew('vega');
  assert.equal('sex' in forVega.get(A.orion), false);
  assert.equal('sex' in forVega.get(A.lyra), false);
  assert.equal(forVega.get(A.vega).sex, 'male'); // el suyo sí

  // Nunca en el dashboard de la tripulación (ni para el flight surgeon).
  for (const who of ['reyes', 'admin']) {
    const dash = await as(who, 'get', '/admin/dashboard/crew');
    assert.equal(dash.status, 200);
    assert.equal(hasSex(dash.body), false, who);
  }
});

test('GET /missions/{id}/crew: 403 fuera de la misión, 404 si no existe, paginado', async (t) => {
  if (skip(t)) return;
  assert.equal((await as('orion', 'get', `/missions/${randomUUID()}/crew`)).status, 404);
  const [other] = await q(
    `INSERT INTO missions (code, name, environment_code, status, starts_at)
     VALUES ('TEST-SEX', 'Prueba (sintética)', 'mars_transit', 'planned', now()) RETURNING id`,
  );
  assert.equal((await as('orion', 'get', `/missions/${other.id}/crew`)).status, 403);
  assert.equal((await as('reyes', 'get', `/missions/${other.id}/crew`)).status, 403);
  assert.equal((await as('admin', 'get', `/missions/${other.id}/crew`)).status, 200);

  const first = await as('reyes', 'get', `/missions/${ARES1}/crew?limit=2`);
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 2);
  assert.ok(first.body.next_cursor);
  const rest = await as(
    'reyes',
    'get',
    `/missions/${ARES1}/crew?limit=200&cursor=${first.body.next_cursor}`,
  );
  const seen = [...first.body.items, ...rest.body.items].map((i) => i.astronaut_id);
  assert.equal(new Set(seen).size, seen.length);
  assert.ok(seen.includes(A.orion) && seen.includes(A.vega));
  assert.equal((await as('reyes', 'get', `/missions/${ARES1}/crew?cursor=nope`)).status, 400);
});

test('motor: una regla con {"field":"sex"} usa el perfil (también en lecturas nuevas)', async (t) => {
  if (skip(t)) return;
  // Versión de prueba de BODY_TEMP (solo en la base de pruebas; no cambia el catálogo).
  const [active] = await q(
    `SELECT id, version, rules FROM indicator_rule_versions
     WHERE indicator_code = 'BODY_TEMP' AND is_active`,
  );
  const rules = [
    {
      level: 'caution',
      when: { all: [{ field: 'sex', op: 'eq', value: 'female' }] },
      recommendation: 'Regla de prueba por sexo.',
      escalation: 'self_care',
      basis: 'design_rule',
      source_ids: [],
    },
    ...active.rules,
  ];
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE indicator_rule_versions SET is_active = false WHERE id = $1', [
      active.id,
    ]);
    await client.query(
      `INSERT INTO indicator_rule_versions (indicator_code, version, rules, is_active, change_reason)
       VALUES ('BODY_TEMP', $1, $2, true, 'prueba de sex')`,
      [active.version + 1, JSON.stringify(rules)],
    );
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  const temp = (who) =>
    as(who, 'post', '/readings').send({
      client_uuid: randomUUID(),
      indicator_code: 'BODY_TEMP',
      measured_at: new Date().toISOString(),
      values: { value: 36.6 },
      input_method: 'manual',
    });
  const orion = await temp('orion'); // female
  const vega = await temp('vega'); // male
  assert.equal(orion.status, 201, JSON.stringify(orion.body));
  assert.equal(orion.body.evaluation.level, 'caution');
  assert.equal(orion.body.evaluation.rule_index, 0);
  assert.equal(vega.body.evaluation.level, 'normal');
  // El contexto no se guarda en los derivados.
  const [ev] = await q('SELECT derived FROM reading_evaluations WHERE reading_id = $1', [
    orion.body.reading.id,
  ]);
  assert.equal('sex' in ev.derived, false);
});
