'use strict';
// Integración: autenticación, administración de cuentas y permisos (supertest + BD local).
// Antes y después de la suite: db:reset (migrate + seed) bajo el advisory lock de las
// suites de BD, así cada suite parte de los datos del seed y los deja igual al terminar.
// Se salta sola si no hay base.
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_LOGIN_PER_MINUTE = '1000'; // la suite hace muchos logins seguidos

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openTestDb, resetDatabase, SKIP_REASON } = require('./helpers/db');

const PASSWORD = 'Demo2026!';
const ARES1 = '20000000-0000-4000-8000-000000000001';
const U = {
  admin: '00000000-0000-4000-8000-000000000001',
  reyes: '00000000-0000-4000-8000-000000000002',
  bh: '00000000-0000-4000-8000-000000000003',
  orion: '00000000-0000-4000-8000-000000000011',
  vega: '00000000-0000-4000-8000-000000000012',
  lyra: '00000000-0000-4000-8000-000000000013',
  atlas: '00000000-0000-4000-8000-000000000014',
};
const A = {
  orion: '10000000-0000-4000-8000-000000000011',
  vega: '10000000-0000-4000-8000-000000000012',
};

let db = null;
let request = null;
let app = null;

before(async () => {
  db = await openTestDb();
  if (!db) return;
  await resetDatabase();
  request = require('supertest');
  app = require('../src/app');
});

after(async () => {
  if (!db) return;
  // Deja la base como el seed para las suites que corran después (y para desarrollo).
  await resetDatabase();
  await require('../src/config/db').pool.end();
  await db.close();
});

const skip = (t) => {
  if (db) return false;
  t.skip(SKIP_REASON);
  return true;
};
const api = () => request(app);
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const login = (username, password = PASSWORD, deviceId = 'tab-test') =>
  api().post('/api/v1/auth/login').send({ username, password, device_id: deviceId });
const q = async (sql, params) => (await db.pool.query(sql, params)).rows;
const count = async (sql, params) => (await q(sql, params))[0].n;

async function tokenFor(username, deviceId) {
  const res = await login(username, PASSWORD, deviceId);
  assert.equal(res.status, 200, `login de ${username}: ${JSON.stringify(res.body)}`);
  return res.body;
}

test('login OK de ORION: tokens, contexto de misión y evento', async (t) => {
  if (skip(t)) return;
  const res = await login('a.ortega');
  assert.equal(res.status, 200);
  assert.equal(res.body.token_type, 'Bearer');
  assert.equal(res.body.expires_in, 900);
  assert.match(res.body.refresh_token, /^rt_/);
  assert.equal(res.body.must_change_password, false);
  assert.equal(res.body.offline_unlock_until, null);
  assert.deepEqual(res.body.user, {
    id: U.orion,
    username: 'a.ortega',
    full_name: 'Ana Ortega (sintética)',
    role: 'astronaut',
    email: null,
  });
  const ctx = res.body.context;
  assert.equal(ctx.astronaut_id, A.orion);
  assert.equal(ctx.call_sign, 'ORION');
  assert.equal(ctx.crew_role, 'commander');
  assert.equal(ctx.mission.code, 'ARES-1');
  assert.equal(ctx.environment.gravity_g, 0);
  assert.equal(ctx.environment.comm_delay_seconds, 90);

  assert.equal(
    await count(
      "SELECT count(*)::int AS n FROM auth_events WHERE user_id = $1 AND event = 'login_success'",
      [U.orion],
    ),
    1,
  );
  const [stored] = await q('SELECT token_hash FROM refresh_tokens WHERE user_id = $1', [U.orion]);
  assert.match(stored.token_hash, /^[0-9a-f]{64}$/, 'solo se guarda el SHA-256');
  assert.notEqual(stored.token_hash, res.body.refresh_token);
});

test('credenciales inválidas: el mismo 401 exista o no el usuario', async (t) => {
  if (skip(t)) return;
  const unknown = await login('no.existe');
  const wrong = await login('k.mensah', 'otra-cosa');
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(unknown.body, wrong.body);
  assert.deepEqual(unknown.body.error, {
    code: 'INVALID_CREDENTIALS',
    message: 'Usuario o contraseña incorrectos.',
    details: null,
  });
  assert.equal(
    await count(
      "SELECT count(*)::int AS n FROM auth_events WHERE event = 'login_failed' AND username IN ('no.existe', 'k.mensah')",
    ),
    2,
  );
});

test('m.silva: 428 → cambio de contraseña → login OK', async (t) => {
  if (skip(t)) return;
  const first = await login('m.silva');
  assert.equal(first.status, 428);
  assert.equal(first.body.error.code, 'PASSWORD_CHANGE_REQUIRED');
  const { password_change_token: changeToken, expires_in, user_id } = first.body.error.details;
  assert.equal(expires_in, 600);
  assert.equal(user_id, U.atlas);

  // El token del 428 solo sirve para cambiar la contraseña.
  assert.equal((await api().get('/api/v1/me').set(bearer(changeToken))).status, 428);

  const change = (body) =>
    api().post('/api/v1/auth/change-password').set(bearer(changeToken)).send(body);
  const weak = await change({ current_password: PASSWORD, new_password: 'corta' });
  assert.equal(weak.status, 400);
  assert.equal(weak.body.error.code, 'WEAK_PASSWORD');
  const wrongCurrent = await change({ current_password: 'mala', new_password: 'Atlas#Mars2026' });
  assert.equal(wrongCurrent.status, 401);
  assert.equal(wrongCurrent.body.error.code, 'INVALID_CREDENTIALS');

  const ok = await change({ current_password: PASSWORD, new_password: 'Atlas#Mars2026' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.must_change_password, false);
  assert.equal(ok.body.context.call_sign, 'ATLAS');
  assert.match(ok.body.refresh_token, /^rt_/);

  // De un solo uso: después del cambio el token del 428 ya no vale.
  const reused = await change({
    current_password: 'Atlas#Mars2026',
    new_password: 'Otra#Clave2026',
  });
  assert.equal(reused.status, 401);

  assert.equal((await login('m.silva')).status, 401, 'la contraseña temporal ya no sirve');
  assert.equal((await login('m.silva', 'Atlas#Mars2026')).status, 200);
  const [row] = await q('SELECT must_change_password FROM users WHERE id = $1', [U.atlas]);
  assert.equal(row.must_change_password, false);
  assert.equal(
    await count(
      "SELECT count(*)::int AS n FROM auth_events WHERE user_id = $1 AND event = 'password_changed'",
      [U.atlas],
    ),
    1,
  );
});

test('5 fallos → 423 con locked_until; admin desbloquea (account_unlocked)', async (t) => {
  if (skip(t)) return;
  for (let i = 1; i <= 4; i += 1) assert.equal((await login('l.tanaka', 'mala')).status, 401);
  const locked = await login('l.tanaka', 'mala');
  assert.equal(locked.status, 423);
  assert.equal(locked.body.error.code, 'ACCOUNT_LOCKED');
  const minutes = (new Date(locked.body.error.details.locked_until) - Date.now()) / 60000;
  assert.ok(minutes > 14 && minutes <= 15.1, `bloqueo de ~15 min, fue ${minutes}`);
  assert.equal(
    (await login('l.tanaka')).status,
    423,
    'bloqueada aunque la contraseña sea correcta',
  );
  assert.equal(
    await count(
      "SELECT count(*)::int AS n FROM auth_events WHERE user_id = $1 AND event = 'account_locked'",
      [U.lyra],
    ),
    1,
  );

  const admin = await tokenFor('mission.control');
  const unlock = await api()
    .post(`/api/v1/admin/users/${U.lyra}/unlock`)
    .set(bearer(admin.access_token));
  assert.equal(unlock.status, 200);
  assert.equal(unlock.body.failed_login_attempts, 0);
  assert.equal(unlock.body.locked_until, null);
  assert.equal(unlock.body.password_hash, undefined, 'nunca se expone el hash');
  assert.equal(
    await count(
      "SELECT count(*)::int AS n FROM auth_events WHERE user_id = $1 AND event = 'account_unlocked'",
      [U.lyra],
    ),
    1,
  );
  assert.equal((await login('l.tanaka')).status, 200);
});

test('refresh rotativo; el reuso → 401 y la familia queda revocada', async (t) => {
  if (skip(t)) return;
  const session = await tokenFor('a.ortega', 'tab-refresh');
  const refresh = (token, deviceId = 'tab-refresh') =>
    api().post('/api/v1/auth/refresh').send({ refresh_token: token, device_id: deviceId });

  const rotated = await refresh(session.refresh_token);
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.body.refresh_token, session.refresh_token);
  assert.equal((await api().get('/api/v1/me').set(bearer(rotated.body.access_token))).status, 200);
  assert.equal((await refresh(rotated.body.refresh_token, 'otro-dispositivo')).status, 401);

  const reuse = await refresh(session.refresh_token);
  assert.equal(reuse.status, 401);
  assert.equal(reuse.body.error.code, 'TOKEN_REUSE_DETECTED');
  assert.deepEqual(reuse.body.error.details, { family_revoked: true });

  const afterReuse = await refresh(rotated.body.refresh_token);
  assert.equal(afterReuse.status, 401, 'el token más nuevo de la familia también quedó revocado');
  assert.equal(afterReuse.body.error.code, 'UNAUTHENTICATED');
  assert.equal(
    await count(
      "SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND device_id = 'tab-refresh' AND revoked_at IS NULL",
      [U.orion],
    ),
    0,
  );
  assert.equal(
    await count(
      "SELECT count(*)::int AS n FROM auth_events WHERE user_id = $1 AND event = 'token_reuse_detected'",
      [U.orion],
    ),
    1,
  );
});

test('logout (204) revoca el refresh del dispositivo y no los de otros', async (t) => {
  if (skip(t)) return;
  const other = await tokenFor('a.ortega', 'tab-otra');
  const session = await tokenFor('a.ortega', 'tab-logout');
  const out = await api().post('/api/v1/auth/logout').set(bearer(session.access_token)).send({});
  assert.equal(out.status, 204);

  const again = await api()
    .post('/api/v1/auth/refresh')
    .send({ refresh_token: session.refresh_token, device_id: 'tab-logout' });
  assert.equal(again.status, 401);
  assert.equal(again.body.error.code, 'UNAUTHENTICATED', 'revocado por logout, no es reuso');

  const otherDevice = await api()
    .post('/api/v1/auth/refresh')
    .send({ refresh_token: other.refresh_token, device_id: 'tab-otra' });
  assert.equal(otherDevice.status, 200);
});

test('GET /me: crew_role vigente, misión y equipo en Tierra', async (t) => {
  if (skip(t)) return;
  const me = async (username) => {
    const { access_token: token } = await tokenFor(username);
    const res = await api().get('/api/v1/me').set(bearer(token));
    assert.equal(res.status, 200);
    return res.body;
  };
  const orion = await me('a.ortega');
  assert.equal(orion.user.role, 'astronaut');
  assert.equal(orion.context.crew_role, 'commander');
  assert.equal(orion.context.mission.code, 'ARES-1');

  assert.equal((await me('k.mensah')).context.crew_role, 'crew_medical_officer');

  const reyes = await me('dr.reyes');
  assert.equal(reyes.user.role, 'flight_surgeon');
  assert.equal(reyes.context.astronaut_id, null);
  assert.equal(reyes.context.crew_role, null);
  assert.deepEqual(
    reyes.context.ground_missions.map((m) => m.code),
    ['ARES-1'],
  );

  assert.equal((await api().get('/api/v1/me')).status, 401);
  const bad = await api().get('/api/v1/me').set(bearer('no-es-un-jwt'));
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.code, 'UNAUTHENTICATED');
});

test('rol service: 403 en todo salvo POST /habitat/readings', async (t) => {
  if (skip(t)) return;
  const svc = await tokenFor('svc.habitat');
  assert.equal(svc.user.role, 'service');
  assert.equal(svc.context.mission.code, 'ARES-1');
  const auth = bearer(svc.access_token);

  for (const [method, path] of [
    ['get', '/api/v1/me'],
    ['post', '/api/v1/admin/users'],
    ['get', '/api/v1/health'],
    ['get', '/api/v1/ruta-que-no-existe'],
    ['get', '/api/v1/habitat/readings'],
  ]) {
    const res = await api()[method](path).set(auth).send({});
    assert.equal(res.status, 403, `${method.toUpperCase()} ${path}`);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  }
  // Su única ruta pasa el filtro (hoy responde 404 porque el endpoint aún no existe).
  const own = await api().post('/api/v1/habitat/readings').set(auth).send({ readings: [] });
  assert.notEqual(own.status, 403);
});

test('requireRole: un astronauta no puede usar /admin/users', async (t) => {
  if (skip(t)) return;
  const { access_token: token } = await tokenFor('a.ortega');
  const res = await api().post('/api/v1/admin/users').set(bearer(token)).send({});
  assert.equal(res.status, 403);
  assert.deepEqual(res.body.error.details, { required_roles: ['admin'] });
});

test('POST /admin/users: contraseña temporal una sola vez y cambio obligatorio', async (t) => {
  if (skip(t)) return;
  const bcrypt = require('bcryptjs');
  const { access_token: admin } = await tokenFor('mission.control');
  const create = (body) => api().post('/api/v1/admin/users').set(bearer(admin)).send(body);
  const astronaut = (over = {}) => ({
    username: 'j.rivera',
    full_name: 'Julia Rivera (sintética)',
    role: 'astronaut',
    astronaut: { call_sign: 'NOVA', agency: 'Demo Agency', mission_id: ARES1, crew_role: 'pilot' },
    ...over,
  });

  const created = await create(astronaut());
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const temp = created.body.temporary_password;
  assert.equal(temp.length, 12);
  assert.equal(created.body.user.must_change_password, true);
  assert.equal(created.body.user.password_hash, undefined);
  assert.equal(created.body.astronaut.call_sign, 'NOVA');
  assert.equal(created.body.assignment.crew_role, 'pilot');
  assert.equal(created.body.assignment.call_sign, 'NOVA');

  const [row] = await q('SELECT password_hash FROM users WHERE username = $1', ['j.rivera']);
  assert.notEqual(row.password_hash, temp, 'nunca se guarda en texto plano');
  assert.ok(await bcrypt.compare(temp, row.password_hash));
  assert.equal(await count('SELECT count(*)::int AS n FROM v_current_crew'), 5);

  const firstLogin = await login('j.rivera', temp);
  assert.equal(firstLogin.status, 428, 'la cuenta nueva exige el cambio');

  // Conflictos y validación
  const dupUser = await create(
    astronaut({ astronaut: { ...astronaut().astronaut, call_sign: 'NOVA2' } }),
  );
  assert.equal(dupUser.status, 409);
  assert.equal(dupUser.body.error.code, 'USERNAME_TAKEN');
  const dupCallSign = await create(
    astronaut({ username: 'j.otra', astronaut: { ...astronaut().astronaut, call_sign: 'nova' } }),
  );
  assert.equal(dupCallSign.body.error.code, 'CALL_SIGN_TAKEN');
  const secondCommander = await create(
    astronaut({
      username: 'j.cmd',
      astronaut: { ...astronaut().astronaut, call_sign: 'CMD2', crew_role: 'commander' },
    }),
  );
  assert.equal(secondCommander.status, 409);
  assert.equal(secondCommander.body.error.code, 'CREW_ROLE_TAKEN');
  const missing = await create({ username: 'x.falta', full_name: 'X', role: 'astronaut' });
  assert.equal(missing.status, 400);
  assert.ok(missing.body.error.details.some((d) => d.field === 'astronaut.call_sign'));

  // Personal de Tierra: sin ground_mission_ids va a las misiones activas del admin.
  const surgeon = await create({
    username: 'dr.lopez',
    full_name: 'Dr. López (sintético)',
    role: 'flight_surgeon',
  });
  assert.equal(surgeon.status, 201);
  const [team] = await q(
    'SELECT g.function, m.code FROM mission_ground_team g JOIN missions m ON m.id = g.mission_id WHERE g.user_id = $1',
    [surgeon.body.user.id],
  );
  assert.deepEqual(team, { function: 'medical', code: 'ARES-1' });

  // Cuenta de servicio: vinculada a su misión.
  const service = await create({
    username: 'svc.rover',
    full_name: 'Sensores del rover (servicio)',
    role: 'service',
    service: { mission_id: ARES1, description: 'Sensores del rover de ARES-1' },
  });
  assert.equal(service.status, 201);
  assert.equal(
    await count('SELECT count(*)::int AS n FROM service_accounts WHERE user_id = $1', [
      service.body.user.id,
    ]),
    1,
  );
});

test('reset-password: contraseña temporal nueva y sesiones revocadas', async (t) => {
  if (skip(t)) return;
  const { access_token: admin } = await tokenFor('mission.control');
  const vega = await tokenFor('k.mensah', 'tab-vega');
  const res = await api().post(`/api/v1/admin/users/${U.vega}/reset-password`).set(bearer(admin));
  assert.equal(res.status, 200);
  assert.equal(res.body.must_change_password, true);
  assert.ok(res.body.revoked_refresh_tokens >= 1);
  assert.equal((await api().get('/api/v1/me').set(bearer(vega.access_token))).status, 401);
  assert.equal((await login('k.mensah')).status, 401, 'la contraseña anterior ya no sirve');
  assert.equal((await login('k.mensah', res.body.temporary_password)).status, 428);

  const unknown = await api()
    .post('/api/v1/admin/users/99999999-0000-4000-8000-000000000000/reset-password')
    .set(bearer(admin));
  assert.equal(unknown.status, 404);
  assert.equal((await api().post('/api/v1/admin/users/abc/unlock').set(bearer(admin))).status, 400);
});

test('con must_change_password y sesión abierta solo hay change-password y logout', async (t) => {
  if (skip(t)) return;
  const lyra = await tokenFor('l.tanaka', 'tab-lyra');
  await q('UPDATE users SET must_change_password = true WHERE id = $1', [U.lyra]);
  const me = await api().get('/api/v1/me').set(bearer(lyra.access_token));
  assert.equal(me.status, 428);
  assert.ok(me.body.error.details.password_change_token);
  const out = await api().post('/api/v1/auth/logout').set(bearer(lyra.access_token)).send({});
  assert.equal(out.status, 204);
});

test('requireCrewRole lee el rol vigente de v_current_crew', async (t) => {
  if (skip(t)) return;
  const { requireCrewRole } = require('../src/middlewares/auth');
  let calls = 0;
  const next = () => (calls += 1);
  await requireCrewRole('commander')({ auth: { userId: U.orion } }, {}, next);
  assert.equal(calls, 1);
  await assert.rejects(
    requireCrewRole('commander')({ auth: { userId: U.vega } }, {}, next),
    (err) => err.status === 403 && err.details.required_crew_roles[0] === 'commander',
  );
  await requireCrewRole('commander', 'crew_medical_officer')(
    { auth: { userId: U.vega } },
    {},
    next,
  );
  assert.equal(calls, 2);
  await assert.rejects(
    requireCrewRole('crew_medical_officer')({ auth: { userId: U.reyes } }, {}, next),
    (err) => err.status === 403,
  );
});

test('cada lectura confidencial permitida deja una fila en confidential_access_log', async (t) => {
  if (skip(t)) return;
  const policy = require('../src/services/accessPolicy');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const logged = async () =>
      (await client.query('SELECT count(*)::int AS n FROM confidential_access_log')).rows[0].n;
    const bh = await policy.loadActor(U.bh, client);
    const surgeon = await policy.loadActor(U.reyes, client);
    const admin = await policy.loadActor(U.admin, client);
    const orion = await policy.loadActor(U.orion, client);
    assert.deepEqual(bh.mission_ids, [ARES1]);
    assert.equal(orion.crew_role, 'commander');

    const req = {
      method: 'GET',
      baseUrl: '/api/v1/admin/behavioral/astronauts',
      route: { path: '/:id' },
      ip: '127.0.0.1',
    };
    const confidential = {
      astronaut_id: A.vega,
      mission_id: ARES1,
      sensitivity: 'confidential',
      category: 'behavioral',
      action: 'read',
    };
    const start = await logged();

    await policy.enforceAccess(bh, confidential, { req, db: client });
    assert.equal(await logged(), start + 1);
    const [entry] = (
      await client.query(
        `SELECT actor_user_id, actor_username, actor_role, astronaut_id, resource, action, host(ip) AS ip
         FROM confidential_access_log ORDER BY accessed_at DESC LIMIT 1`,
      )
    ).rows;
    assert.deepEqual(entry, {
      actor_user_id: U.bh,
      actor_username: 'bh.salas',
      actor_role: 'behavioral_health',
      astronaut_id: A.vega,
      resource: 'GET /api/v1/admin/behavioral/astronauts/:id',
      action: 'read',
      ip: '127.0.0.1',
    });

    // Lo estándar permitido no deja fila.
    await policy.enforceAccess(
      surgeon,
      { ...confidential, sensitivity: 'standard', category: 'physical' },
      { req, db: client },
    );
    await policy.enforceAccess(
      admin,
      { ...confidential, sensitivity: 'standard', view: 'compliance' },
      { req, db: client },
    );
    assert.equal(await logged(), start + 1);

    // Lo denegado responde 403 y tampoco deja fila.
    for (const actor of [surgeon, admin, orion]) {
      await assert.rejects(
        policy.enforceAccess(actor, confidential, { req, db: client }),
        (err) => err.status === 403,
      );
    }
    assert.equal(await logged(), start + 1);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
