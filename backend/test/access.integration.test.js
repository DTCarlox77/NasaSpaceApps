'use strict';
// Registro y acceso (tarea 11) contra la base de PRUEBAS: credencial de tableta para la
// emergencia sin sesión, gestión de tabletas, bloqueo por intentos, permisos delegados del
// comandante con su bitácora y entrega a Tierra, y PIN de desbloqueo sin conexión.
const { openTestDb, resetDatabase } = require('./helpers/db'); // antes que cualquier src/
process.env.RATE_LIMIT_LOGIN_PER_MINUTE = '1000';
process.env.RATE_LIMIT_DEVICE_CREDENTIAL_PER_MINUTE = '5';
process.env.SYNC_PULL_SETTLE_MS = '0';
process.env.LOCKOUT_MAX_ATTEMPTS = '5';
process.env.LOCKOUT_MINUTES = '15';
process.env.OFFLINE_UNLOCK_DAYS = '3';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { randomUUID } = crypto;

const ARES1 = '20000000-0000-4000-8000-000000000001';
const A = {
  orion: '10000000-0000-4000-8000-000000000011',
  vega: '10000000-0000-4000-8000-000000000012',
  lyra: '10000000-0000-4000-8000-000000000013',
};
const U = {
  admin: '00000000-0000-4000-8000-000000000001',
  orion: '00000000-0000-4000-8000-000000000011',
  vega: '00000000-0000-4000-8000-000000000012',
  lyra: '00000000-0000-4000-8000-000000000013',
};
const USERS = {
  admin: 'mission.control',
  reyes: 'dr.reyes',
  bh: 'bh.salas',
  orion: 'a.ortega',
  vega: 'k.mensah',
  lyra: 'l.tanaka',
};
const DEVICE = { orion: 'ipad-orion', vega: 'ipad-vega', lyra: 'ipad-lyra' };
const TAB1 = 'dc_demo_tab1_sintetica'; // credencial sintética del seed (solo demo)
const sha256 = (v) => crypto.createHash('sha256').update(v, 'utf8').digest('hex');

let db = null;
let SKIP_REASON = '';
let request = null;
let app = null;
const tokens = {};
const secrets = []; // todo secreto que se vio: no debe aparecer en la base ni en otra respuesta

// Todo lo que el proceso escribe por console.* (la app y sus dependencias) para buscar secretos.
const consoleLines = [];
for (const method of ['log', 'info', 'warn', 'error']) {
  const original = console[method].bind(console);
  console[method] = (...args) => {
    consoleLines.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' '));
    original(...args);
  };
}

async function login(name, deviceId = DEVICE[name] || 'console-test', password = 'Demo2026!') {
  return request(app)
    .post('/api/v1/auth/login')
    .send({ username: USERS[name] || name, password, device_id: deviceId });
}

before(async () => {
  const opened = await openTestDb();
  db = opened.db;
  SKIP_REASON = opened.reason;
  if (!db) return;
  await resetDatabase();
  request = require('supertest');
  app = require('../src/app');
  for (const name of Object.keys(USERS)) {
    const res = await login(name);
    assert.equal(res.status, 200, `login ${name}`);
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
const api = (who, method, url, body) => {
  const r = request(app)[method](`/api/v1${url}`).set('Authorization', `Bearer ${tokens[who]}`);
  return body === undefined ? r : r.send(body);
};
/** Petición SIN sesión, con la credencial de una tableta. */
const tablet = (credential, method, url, body) => {
  const r = request(app)[method](`/api/v1${url}`).set('X-Device-Credential', credential);
  return body === undefined ? r : r.send(body);
};
const iso = (ms = Date.now()) => new Date(ms).toISOString();

const openSessionRow = async () =>
  (
    await q(
      `SELECT id FROM emergency_sessions WHERE mission_id = $1 AND status IN ('pending', 'active')`,
      [ARES1],
    )
  )[0];
async function closeOpen() {
  const open = await openSessionRow();
  if (!open) return;
  const res = await api('orion', 'post', `/emergency/sessions/${open.id}/close`, {
    closed_at: iso(),
    status: 'cancelled',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}
const answers = (map) =>
  Object.entries(map).map(([code, value]) => ({
    client_uuid: randomUUID(),
    question_code: code,
    answer: Array.isArray(value) ? { choice: value } : { value },
    source: 'tap',
    answered_at: iso(),
  }));
const GREEN = { responsive_and_mobile: true, vomiting: false, prodromal_symptoms: ['none'] };

// ---------------------------------------------------------------- tabletas (admin)

let spare = null; // { device, credential } registrada por admin en ARES-1
let otherMissionId = null; // misión ACC-2 (activa desde la prueba de tabletas)

test('admin registra una tableta: la credencial sale una sola vez y solo se guarda su SHA-256', async (t) => {
  if (skip(t)) return;
  const res = await api('admin', 'post', '/admin/devices', {
    label: 'TAB-T1',
    mission_id: ARES1,
    module_id: 'HAB-1',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  spare = res.body;
  secrets.push(spare.credential);
  assert.match(spare.credential, /^dc_[A-Za-z0-9_-]{43}$/);
  assert.equal(spare.device.label, 'TAB-T1');
  assert.equal(spare.device.registered_via, 'admin');
  assert.equal(spare.device.registered_by, U.admin);
  assert.equal(spare.device.status, 'active');
  assert.ok(!('credential_hash' in spare.device));
  const [row] = await q('SELECT credential_hash FROM devices WHERE id = $1', [spare.device.id]);
  assert.equal(row.credential_hash, sha256(spare.credential), 'solo el SHA-256');

  // Nunca más: ni en la lista ni en la base en claro.
  const list = await api('admin', 'get', `/admin/devices?mission_id=${ARES1}`);
  assert.equal(list.status, 200);
  assert.ok(list.body.items.some((d) => d.id === spare.device.id));
  assert.deepEqual(list.body.items.map((d) => d.label).sort(), ['TAB-1', 'TAB-2', 'TAB-T1']);
  const text = JSON.stringify(list.body);
  assert.ok(!text.includes(spare.credential) && !text.includes(row.credential_hash));
  assert.ok(!text.includes('credential'));

  const dup = await api('admin', 'post', '/admin/devices', { label: 'tab-t1', mission_id: ARES1 });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'DEVICE_LABEL_TAKEN');
  const missing = await api('admin', 'post', '/admin/devices', {
    label: 'TAB-X',
    mission_id: randomUUID(),
  });
  assert.equal(missing.status, 404);
  for (const who of ['reyes', 'bh', 'orion']) {
    assert.equal((await api(who, 'get', '/admin/devices')).status, 403, who);
    assert.equal(
      (await api(who, 'post', '/admin/devices', { label: 'X', mission_id: ARES1 })).status,
      403,
      who,
    );
  }
  const [event] = await q(
    `SELECT user_id, device_id FROM auth_events WHERE event = 'device_registered' AND device_id = $1`,
    [spare.device.id],
  );
  assert.equal(event.user_id, U.admin);
});

// ---------------------------------------------------------------- emergencia sin sesión

test('credencial de tableta: abre y evalúa un triaje sin sesión; queda en la bitácora', async (t) => {
  if (skip(t)) return;
  await closeOpen();
  const cred = spare.credential;
  const protocol = await tablet(cred, 'get', '/emergency/protocol');
  assert.equal(protocol.status, 200);

  const opened = await tablet(cred, 'post', '/emergency/sessions', {
    client_uuid: randomUUID(),
    trigger_type: 'manual_button',
    started_at: iso(),
    context: { solar_event_active: false },
    responder_safe: { value: true },
  });
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  const sessionId = opened.body.session.id;
  const [row] = await q('SELECT device_id, started_by FROM emergency_sessions WHERE id = $1', [
    sessionId,
  ]);
  assert.equal(row.device_id, spare.device.id, 'la sesión guarda la tableta');
  assert.equal(row.started_by, null, 'sin usuario');
  const [openedEvent] = await q(
    `SELECT actor_device, actor_user_id FROM emergency_events
     WHERE session_id = $1 AND event_type = 'opened'`,
    [sessionId],
  );
  assert.deepEqual(openedEvent, { actor_device: 'TAB-T1', actor_user_id: null });
  const [authEvent] = await q(
    `SELECT user_id, device_id, ip FROM auth_events
     WHERE event = 'device_emergency_started' ORDER BY id DESC LIMIT 1`,
  );
  assert.equal(authEvent.device_id, spare.device.id);
  assert.equal(authEvent.user_id, null);

  assert.equal((await tablet(cred, 'get', `/emergency/sessions/${sessionId}`)).status, 200);
  const created = await tablet(cred, 'post', `/emergency/sessions/${sessionId}/assessments`, {
    client_uuid: randomUUID(),
    astronaut_id: A.lyra,
    started_at: iso(),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const put = await tablet(cred, 'put', `/emergency/assessments/${created.body.id}/answers`, {
    answers: answers(GREEN),
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const done = await tablet(cred, 'post', `/emergency/assessments/${created.body.id}/complete`, {
    completed_at: iso(),
    device_result: {
      status: 'completed',
      triage_category: 'green',
      radiation_flag: 'none',
      rules_version: 2,
    },
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.triage_category, 'green');
  const [assessed] = await q('SELECT assessed_by FROM emergency_assessments WHERE id = $1', [
    created.body.id,
  ]);
  assert.equal(assessed.assessed_by, null);

  const beat = await tablet(cred, 'post', `/emergency/sessions/${sessionId}/heartbeat`, {
    sent_at: iso(),
  });
  assert.equal(beat.status, 200, JSON.stringify(beat.body));
  const question = await tablet(cred, 'post', `/emergency/sessions/${sessionId}/questions`, {
    client_uuid: randomUUID(),
    body: 'Pregunta de prueba desde la tableta.',
    asked_at: iso(),
  });
  assert.equal(question.status, 201, JSON.stringify(question.body));
  const closed = await tablet(cred, 'post', `/emergency/sessions/${sessionId}/close`, {
    closed_at: iso(),
    status: 'closed',
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  const actors = await q(
    `SELECT DISTINCT actor_device FROM emergency_events
     WHERE session_id = $1 AND actor_device IS NOT NULL`,
    [sessionId],
  );
  assert.deepEqual(
    actors.map((r) => r.actor_device),
    ['TAB-T1'],
  );
});

test('credencial de tableta: "estoy bien" del afectado desde la tableta (con astronaut_id)', async (t) => {
  if (skip(t)) return;
  await closeOpen();
  // Lectura crítica de LYRA → sesión pending con hombre muerto.
  const reading = await api('lyra', 'post', '/readings', {
    client_uuid: randomUUID(),
    indicator_code: 'SPO2',
    measured_at: iso(),
    values: { value: 89 },
    input_method: 'wearable',
  });
  assert.equal(reading.status, 201, JSON.stringify(reading.body));
  const sessionId = reading.body.emergency.session_id;
  const noWho = await tablet(TAB1, 'post', `/emergency/sessions/${sessionId}/confirm`, {
    confirmed_at: iso(),
  });
  assert.equal(noWho.status, 400);
  const other = await tablet(TAB1, 'post', `/emergency/sessions/${sessionId}/confirm`, {
    astronaut_id: A.vega,
  });
  assert.equal(other.status, 409, 'VEGA no tiene plazo pendiente en esta sesión');
  const ok = await tablet(TAB1, 'post', `/emergency/sessions/${sessionId}/confirm`, {
    astronaut_id: A.lyra,
    confirmed_at: iso(),
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.session.status, 'cancelled');
  const [event] = await q(
    `SELECT actor_device, astronaut_id FROM emergency_events
     WHERE session_id = $1 AND event_type = 'deadman_confirmed'`,
    [sessionId],
  );
  assert.deepEqual(event, { actor_device: 'TAB-1', astronaut_id: A.lyra });
});

test('credencial de tableta: no sirve fuera del triaje (ni /me, ni lecturas, ni bienestar, ni /admin)', async (t) => {
  if (skip(t)) return;
  for (const [method, url] of [
    ['get', '/me'],
    ['get', '/me/readings'],
    ['get', '/me/body-status'],
    ['post', '/readings'],
    ['get', '/me/wellbeing'],
    ['post', '/wellbeing/checkins'],
    ['post', '/wellbeing/support-requests'],
    ['get', '/sync/pull'],
    ['post', '/sync/push'],
    ['get', '/admin/inbox'],
    ['get', '/admin/devices'],
    ['get', '/admin/emergencies'],
    ['get', '/admin/behavioral/inbox'],
    ['get', '/admin/dashboard/crew'],
    ['put', '/me/offline-pin'],
    ['post', `/crew/users/${U.lyra}/unlock`],
  ]) {
    const res = await tablet(TAB1, method, url, method === 'get' ? undefined : {});
    assert.equal(res.status, 401, `${method} ${url}`);
  }
});

test('tableta revocada, de otra misión o inválida → 401; los fallos quedan en la bitácora y se limitan por IP', async (t) => {
  if (skip(t)) return;
  const { resetFailureLimiter } = require('../src/services/devices.service');
  resetFailureLimiter();
  await closeOpen();
  const session = await api('orion', 'post', '/emergency/sessions', {
    client_uuid: randomUUID(),
    trigger_type: 'manual_button',
    started_at: iso(),
    responder_safe: { value: true },
  });
  assert.equal(session.status, 201, JSON.stringify(session.body));
  const sessionId = session.body.session.id;

  // Revocada: deja de servir de inmediato.
  const revoked = await api('admin', 'post', `/admin/devices/${spare.device.id}/revoke`);
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body.status, 'revoked');
  assert.ok(revoked.body.revoked_at);
  const again = await api('admin', 'post', `/admin/devices/${spare.device.id}/revoke`);
  assert.equal(again.body.revoked_at, revoked.body.revoked_at, 'idempotente');
  const denied = await tablet(spare.credential, 'get', `/emergency/sessions/${sessionId}`);
  assert.equal(denied.status, 401);
  assert.equal(denied.body.error.code, 'INVALID_DEVICE_CREDENTIAL');
  const [failed] = await q(
    `SELECT device_id FROM auth_events WHERE event = 'device_auth_failed' ORDER BY id DESC LIMIT 1`,
  );
  assert.equal(failed.device_id, spare.device.id);
  const [revokedEvent] = await q(
    `SELECT user_id FROM auth_events WHERE event = 'device_revoked' AND device_id = $1`,
    [spare.device.id],
  );
  assert.equal(revokedEvent.user_id, U.admin);

  // Otra misión: su tableta no opera la sesión de ARES-1; y si su misión no está activa, nada.
  const mission = await api('admin', 'post', '/admin/missions', {
    code: 'ACC-2',
    name: 'Misión de prueba (acceso)',
    environment_code: 'mars_transit',
    starts_at: iso(Date.now() - 86400000),
  });
  assert.equal(mission.status, 201, JSON.stringify(mission.body));
  otherMissionId = mission.body.id;
  const otherTab = await api('admin', 'post', '/admin/devices', {
    label: 'TAB-OTRA',
    mission_id: mission.body.id,
  });
  assert.equal(otherTab.status, 201);
  secrets.push(otherTab.body.credential);
  const planned = await tablet(otherTab.body.credential, 'post', '/emergency/sessions', {
    client_uuid: randomUUID(),
    trigger_type: 'manual_button',
    started_at: iso(),
  });
  assert.equal(planned.status, 401, 'su misión no está activa');
  const activate = await api('admin', 'patch', `/admin/missions/${mission.body.id}`, {
    status: 'active',
  });
  assert.equal(activate.status, 200, JSON.stringify(activate.body));
  const cross = await tablet(otherTab.body.credential, 'get', `/emergency/sessions/${sessionId}`);
  assert.equal(cross.status, 401, 'tableta de otra misión');

  // Límite por IP (RATE_LIMIT_DEVICE_CREDENTIAL_PER_MINUTE = 5 en esta suite).
  resetFailureLimiter();
  for (let i = 0; i < 5; i += 1) {
    const bad = await tablet(`dc_no-existe-${i}`, 'get', '/emergency/protocol');
    assert.equal(bad.status, 401);
  }
  const limited = await tablet(TAB1, 'get', '/emergency/protocol');
  assert.equal(limited.status, 429, 'bloquea a la IP aunque ahora traiga una válida');
  assert.ok(Number(limited.headers['retry-after']) > 0);
  resetFailureLimiter();
  assert.equal((await tablet(TAB1, 'get', '/emergency/protocol')).status, 200);

  // La credencial nunca se guarda: ni en auth_events ni en ninguna tabla de texto.
  const dump = JSON.stringify(await q('SELECT * FROM auth_events'));
  for (const s of [...secrets, TAB1])
    assert.ok(!dump.includes(s), 'sin credenciales en auth_events');
  await closeOpen();
});

// ---------------------------------------------------------------- bloqueo por intentos

const wrongLogin = (name) => login(name, DEVICE[name], 'contraseña-incorrecta');

test('bloqueo: 5 intentos → 423; mensaje genérico; desbloqueo por tiempo y por el comandante', async (t) => {
  if (skip(t)) return;
  const ghost = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'no.existe', password: 'x'.repeat(12), device_id: 'console-test' });
  for (let i = 1; i <= 4; i += 1) {
    const res = await wrongLogin('lyra');
    assert.equal(res.status, 401, `intento ${i}`);
    assert.deepEqual(res.body, ghost.body, 'mismo 401 exista o no el usuario');
  }
  const locked = await wrongLogin('lyra');
  assert.equal(locked.status, 423);
  assert.equal(locked.body.error.code, 'ACCOUNT_LOCKED');
  const until = new Date(locked.body.error.details.locked_until).getTime();
  assert.ok(Math.abs(until - Date.now() - 15 * 60 * 1000) < 10000, 'LOCKOUT_MINUTES = 15');
  // Con la contraseña correcta también 423: el bloqueo no revela si acertó.
  const right = await login('lyra');
  assert.equal(right.status, 423);
  assert.deepEqual(Object.keys(right.body.error.details), ['locked_until']);
  const events = async () =>
    (
      await q(
        `SELECT event FROM auth_events WHERE user_id = $1 AND event <> 'login_failed' ORDER BY id`,
        [U.lyra],
      )
    ).map((r) => r.event);
  assert.equal((await events()).filter((e) => e === 'account_locked').length, 1);

  // Pasan los 15 min (se mueve locked_until): entra y queda el desbloqueo en la bitácora.
  await q(`UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1`, [U.lyra]);
  const back = await login('lyra');
  assert.equal(back.status, 200, JSON.stringify(back.body));
  tokens.lyra = back.body.access_token;
  assert.equal((await events()).filter((e) => e === 'account_unlocked').length, 1);

  // Otra vez bloqueada: la desbloquea el comandante (ORION) a bordo.
  for (let i = 0; i < 5; i += 1) await wrongLogin('lyra');
  assert.equal((await login('lyra')).status, 423);
  const unlock = await api('orion', 'post', `/crew/users/${U.lyra}/unlock`);
  assert.equal(unlock.status, 200, JSON.stringify(unlock.body));
  assert.deepEqual(Object.keys(unlock.body).sort(), [
    'action',
    'audit',
    'performed_at',
    'target_user_id',
  ]);
  assert.equal(unlock.body.action, 'unlock_user');
  assert.equal(unlock.body.target_user_id, U.lyra);
  const after = await login('lyra');
  assert.equal(after.status, 200);
  tokens.lyra = after.body.access_token;
  assert.ok((await events()).includes('delegated_unlock'));
  const [row] = await q(
    `SELECT actor_user_id, crew_role::text AS crew_role, action, target_type, target_id, details
     FROM delegated_actions WHERE action = 'unlock_user' ORDER BY received_at DESC LIMIT 1`,
  );
  assert.deepEqual(row, {
    actor_user_id: U.orion,
    crew_role: 'commander',
    action: 'unlock_user',
    target_type: 'user',
    target_id: U.lyra,
    details: { was_locked: true },
  });
});

// ---------------------------------------------------------------- comandante

test('comandante: solo él y solo sobre su misión vigente', async (t) => {
  if (skip(t)) return;
  for (const who of ['vega', 'lyra']) {
    const res = await api(who, 'post', `/crew/users/${U.orion}/unlock`);
    assert.equal(res.status, 403, `${who} no es comandante`);
  }
  for (const who of ['admin', 'reyes', 'bh']) {
    assert.equal((await api(who, 'post', `/crew/users/${U.lyra}/unlock`)).status, 403, who);
    assert.equal((await api(who, 'post', '/crew/devices', { label: 'X' })).status, 403, who);
  }
  // Un tripulante de otra misión (ACC-2), alguien de Tierra o un id inventado: 404.
  const other = await api('admin', 'post', '/admin/users', {
    username: 't.otra',
    full_name: 'Tripulante de otra misión (sintético)',
    role: 'astronaut',
    astronaut: { call_sign: 'OTRA', mission_id: otherMissionId, crew_role: 'mission_specialist' },
  });
  assert.equal(other.status, 201, JSON.stringify(other.body));
  secrets.push(other.body.temporary_password);
  for (const id of [other.body.user.id, U.admin, randomUUID()]) {
    assert.equal((await api('orion', 'post', `/crew/users/${id}/unlock`)).status, 404, id);
    assert.equal((await api('orion', 'post', `/crew/users/${id}/reset-pin`)).status, 404, id);
  }
  assert.equal((await api('orion', 'post', '/crew/users/no-uuid/unlock')).status, 400);
});

test('comandante: el permiso NO da acceso a datos médicos ni de bienestar', async (t) => {
  if (skip(t)) return;
  // LYRA tiene datos físicos (SpO₂ crítico) y de bienestar (check-in, solicitud de apoyo).
  const checkin = await api('lyra', 'post', '/wellbeing/checkins', {
    client_uuid: randomUUID(),
    measured_at: iso(Date.now() - 60000),
    mood: 40,
    fatigue: 60,
    stress: 70,
    crew_conflict: 20,
    private_note: 'NOTA-DE-LYRA',
  });
  assert.equal(checkin.status, 201, JSON.stringify(checkin.body));
  const support = await api('lyra', 'post', '/wellbeing/support-requests', {
    client_uuid: randomUUID(),
    urgency: 'today',
    channel: 'message',
    content: 'SOLICITUD-DE-LYRA',
    created_at: iso(Date.now() - 1000),
  });
  assert.equal(support.status, 201);
  const [escalation] = await q(
    `SELECT id FROM escalations WHERE astronaut_id = $1 AND category = 'physical' LIMIT 1`,
    [A.lyra],
  );
  assert.ok(escalation, 'LYRA tiene un escalamiento físico');
  for (const [method, url] of [
    ['get', '/admin/dashboard/crew'],
    ['get', '/admin/inbox'],
    ['get', '/admin/compliance'],
    ['get', '/admin/behavioral/inbox'],
    ['get', `/admin/behavioral/astronauts/${A.lyra}`],
    ['get', `/escalations/${escalation.id}/messages`],
    ['get', '/admin/devices'],
    ['get', '/admin/audit/delegated-actions'],
  ]) {
    assert.equal((await api('orion', method, url)).status, 403, `${method} ${url}`);
  }
  const thread = await api(
    'orion',
    'get',
    `/wellbeing/support-requests/${support.body.id}/messages`,
  );
  assert.equal(thread.status, 404, 'la solicitud de LYRA no existe para el comandante');
  const crew = await api('orion', 'get', `/missions/${ARES1}/crew`);
  assert.equal(crew.status, 200);
  const others = crew.body.items.filter((m) => m.astronaut_id !== A.orion);
  assert.equal(others.length, 3);
  assert.ok(
    others.every((m) => !('sex' in m)),
    'ni el sexo biológico de otros',
  );
  // Lo suyo sí, y nunca lo de LYRA.
  const own = await api('orion', 'get', '/me/wellbeing?limit=200');
  const ownText = JSON.stringify(own.body);
  for (const leak of ['NOTA-DE-LYRA', 'SOLICITUD-DE-LYRA', support.body.id, checkin.body.id]) {
    assert.ok(!ownText.includes(leak));
  }
  // Las respuestas de sus acciones no traen nada clínico.
  const reset = await api('orion', 'post', `/crew/users/${U.lyra}/reset-pin`);
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.ok(!/level|value|mood|SPO2|WB_|note/.test(JSON.stringify(reset.body)));
});

/** delegated_actions es append-only: para simular el paso del tiempo se apaga el trigger. */
async function ageDelegated(minutes) {
  await q('ALTER TABLE delegated_actions DISABLE TRIGGER delegated_actions_append_only');
  try {
    await q(
      `UPDATE delegated_actions SET received_at = received_at - make_interval(mins => $1),
                                    performed_at = performed_at - make_interval(mins => $1)`,
      [minutes],
    );
  } finally {
    await q('ALTER TABLE delegated_actions ENABLE TRIGGER delegated_actions_append_only');
  }
}

test('comandante: cada acción queda en delegated_actions y llega a Tierra con deliver_at (no durante un corte)', async (t) => {
  if (skip(t)) return;
  const spareTab = await api('orion', 'post', '/crew/devices', {
    label: 'TAB-REP',
    module_id: 'HAB-2',
  });
  assert.equal(spareTab.status, 201, JSON.stringify(spareTab.body));
  secrets.push(spareTab.body.credential);
  assert.match(spareTab.body.credential, /^dc_[A-Za-z0-9_-]{43}$/);
  assert.equal(spareTab.body.device.registered_via, 'commander');
  assert.equal(spareTab.body.device.registered_by, U.orion);
  assert.equal(spareTab.body.device.mission_id, ARES1);
  assert.equal(spareTab.body.audit.reported_to_earth, true);
  const [received] = await q('SELECT received_at FROM delegated_actions WHERE id = $1', [
    spareTab.body.audit.audit_id,
  ]);
  assert.equal(
    new Date(spareTab.body.audit.deliver_at) - received.received_at,
    90 * 1000,
    'retraso de ARES-1',
  );
  // La tableta de repuesto ya opera el triaje.
  assert.equal((await tablet(spareTab.body.credential, 'get', '/emergency/protocol')).status, 200);

  const audit = async () =>
    (await api('admin', 'get', `/admin/audit/delegated-actions?mission_id=${ARES1}&limit=200`))
      .body;
  const before = await audit();
  assert.ok(
    before.items.every((i) => i.id !== spareTab.body.audit.audit_id),
    'todavía no llegó a Tierra',
  );
  await ageDelegated(3);
  const arrived = await audit();
  const item = arrived.items.find((i) => i.id === spareTab.body.audit.audit_id);
  assert.ok(item, JSON.stringify(arrived));
  assert.equal(item.actor_call_sign, 'ORION');
  assert.equal(item.action, 'register_device');
  assert.equal(item.target_type, 'device');
  assert.ok(new Date(item.deliver_at) <= new Date());
  assert.deepEqual([...new Set(arrived.items.map((i) => i.action))].sort(), [
    'register_device',
    'reset_offline_pin',
    'unlock_user',
  ]);

  // Corte de enlace abierto: la acción queda en cola (deliver_at null) y Tierra no la ve.
  const outage = await api('admin', 'post', '/admin/comm-outages', {
    mission_id: ARES1,
    starts_at: iso(Date.now() - 1000),
    reason: 'Corte de prueba (acceso)',
  });
  assert.equal(outage.status, 201, JSON.stringify(outage.body));
  const queued = await api('orion', 'post', `/crew/users/${U.vega}/unlock`);
  assert.equal(queued.status, 200);
  assert.equal(queued.body.audit.deliver_at, null);
  assert.equal(queued.body.audit.reported_to_earth, false);
  assert.ok((await audit()).items.every((i) => i.id !== queued.body.audit.audit_id));
  // Vuelve el enlace: sale al cerrar el corte + 90 s (derivado al leer, sin tocar la fila).
  await api('admin', 'patch', `/admin/comm-outages/${outage.body.id}`, { ends_at: iso() });
  assert.ok(
    (await audit()).items.every((i) => i.id !== queued.body.audit.audit_id),
    'en camino',
  );
  await q(
    `UPDATE mission_comm_outages SET starts_at = starts_at - interval '3 minutes',
                                     ends_at = ends_at - interval '3 minutes' WHERE id = $1`,
    [outage.body.id],
  );
  await ageDelegated(3);
  assert.ok(
    (await audit()).items.some((i) => i.id === queued.body.audit.audit_id),
    'llegó',
  );

  for (const who of ['reyes', 'bh', 'orion']) {
    assert.equal((await api(who, 'get', '/admin/audit/delegated-actions')).status, 403, who);
  }
});

// ---------------------------------------------------------------- PIN sin conexión

const pinRow = async (userId, deviceId) =>
  (
    await q(
      `SELECT pin_hash, offline_unlock_until, reset_at, reset_by FROM offline_pins
       WHERE user_id = $1 AND device_id = $2`,
      [userId, deviceId],
    )
  )[0];

test('PIN: se guarda solo el hash; offline_unlock_until respeta OFFLINE_UNLOCK_DAYS; un PIN nuevo invalida el anterior', async (t) => {
  if (skip(t)) return;
  const bcrypt = require('bcryptjs');
  const DAY = 24 * 60 * 60 * 1000;
  const res = await api('vega', 'put', '/me/offline-pin', {
    pin: '482915',
    device_id: DEVICE.vega,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  secrets.push('482915');
  assert.equal(res.body.device_id, DEVICE.vega);
  const until = new Date(res.body.offline_unlock_until).getTime();
  assert.ok(Math.abs(until - Date.now() - 3 * DAY) < 10000, 'OFFLINE_UNLOCK_DAYS = 3');
  assert.deepEqual(res.body.offline_verifier, {
    kdf: 'PBKDF2-HMAC-SHA256',
    iterations: 600000,
    salt_bytes: 16,
    max_attempts: 5,
  });
  assert.ok(!JSON.stringify(res.body).includes('482915'), 'el PIN no vuelve');
  const row = await pinRow(U.vega, DEVICE.vega);
  assert.match(row.pin_hash, /^\$2[aby]\$\d{2}\$/, 'bcrypt');
  assert.ok(await bcrypt.compare('482915', row.pin_hash));
  const [event] = await q(
    `SELECT device_id FROM auth_events WHERE user_id = $1 AND event = 'offline_pin_set'`,
    [U.vega],
  );
  assert.equal(event.device_id, DEVICE.vega);

  // Cambiarlo invalida el anterior.
  const changed = await api('vega', 'put', '/me/offline-pin', {
    pin: '739184',
    device_id: DEVICE.vega,
  });
  assert.equal(changed.status, 200);
  secrets.push('739184');
  const after = await pinRow(U.vega, DEVICE.vega);
  assert.equal(await bcrypt.compare('482915', after.pin_hash), false);
  assert.equal(await bcrypt.compare('739184', after.pin_hash), true);

  // Un login en línea en ese dispositivo trae (y renueva) la ventana; en otro, null.
  const again = await login('vega');
  assert.equal(again.status, 200);
  tokens.vega = again.body.access_token;
  assert.ok(new Date(again.body.offline_unlock_until).getTime() >= until);
  assert.equal((await login('vega', 'otro-dispositivo')).body.offline_unlock_until, null);

  // Validación y dueño del dispositivo.
  for (const pin of ['123', '123456789', '12a4', 4821]) {
    const bad = await api('vega', 'put', '/me/offline-pin', { pin, device_id: DEVICE.vega });
    assert.equal(bad.status, 400, String(pin));
  }
  const foreign = await api('vega', 'put', '/me/offline-pin', {
    pin: '5555',
    device_id: 'ipad-orion',
  });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.error.code, 'DEVICE_NOT_OWNED');
  for (const who of ['admin', 'reyes', 'bh']) {
    assert.equal(
      (await api(who, 'put', '/me/offline-pin', { pin: '1234', device_id: 'console-test' })).status,
      403,
      who,
    );
  }
});

test('PIN: no sirve como credencial del servidor', async (t) => {
  if (skip(t)) return;
  const asPassword = await login('vega', DEVICE.vega, '739184');
  assert.equal(asPassword.status, 401);
  const asBearer = await request(app).get('/api/v1/me').set('Authorization', 'Bearer 7391');
  assert.equal(asBearer.status, 401);
  const asTablet = await tablet('739184', 'get', '/emergency/protocol');
  assert.equal(asTablet.status, 401);
  const asRefresh = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refresh_token: '739184', device_id: DEVICE.vega });
  assert.equal(asRefresh.status, 401);
  // La sincronización exige sesión: sin token no entra nada.
  const push = await request(app).post('/api/v1/sync/push').send({});
  assert.equal(push.status, 401);
  require('../src/services/devices.service').resetFailureLimiter();
});

test('PIN: lo restablece el comandante y lo invalida la revocación de la tableta', async (t) => {
  if (skip(t)) return;
  // Comandante: borra el PIN de VEGA en todos sus dispositivos.
  const reset = await api('orion', 'post', `/crew/users/${U.vega}/reset-pin`);
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  const row = await pinRow(U.vega, DEVICE.vega);
  assert.equal(row.pin_hash, null);
  assert.equal(row.offline_unlock_until, null);
  assert.equal(row.reset_by, U.orion);
  assert.equal((await login('vega')).body.offline_unlock_until, null, 'la app pide un PIN nuevo');
  const [event] = await q(
    `SELECT event FROM auth_events WHERE user_id = $1 AND event = 'pin_reset' ORDER BY id DESC LIMIT 1`,
    [U.vega],
  );
  assert.ok(event);

  // LYRA define su PIN en la tableta compartida TAB-2; admin la revoca → PIN inválido.
  const onTab = await login('lyra', 'TAB-2');
  assert.equal(onTab.status, 200);
  const set = await request(app)
    .put('/api/v1/me/offline-pin')
    .set('Authorization', `Bearer ${onTab.body.access_token}`)
    .send({ pin: '246813', device_id: 'TAB-2' });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  secrets.push('246813');
  const [tab2] = await q(`SELECT id FROM devices WHERE label = 'TAB-2' AND mission_id = $1`, [
    ARES1,
  ]);
  const revoke = await api('admin', 'post', `/admin/devices/${tab2.id}/revoke`);
  assert.equal(revoke.status, 200);
  const gone = await pinRow(U.lyra, 'TAB-2');
  assert.equal(gone.pin_hash, null);
  assert.equal(gone.offline_unlock_until, null);
  const retry = await request(app)
    .put('/api/v1/me/offline-pin')
    .set('Authorization', `Bearer ${onTab.body.access_token}`)
    .send({ pin: '246813', device_id: 'TAB-2' });
  assert.equal(retry.status, 403, 'no se define un PIN en una tableta revocada');
  assert.equal(retry.body.error.code, 'DEVICE_REVOKED');
});

// ---------------------------------------------------------------- secretos

test('ningún secreto aparece en la base en claro, en la bitácora ni en respuestas posteriores', async (t) => {
  if (skip(t)) return;
  const all = [...new Set([...secrets, TAB1])].filter(Boolean);
  assert.ok(all.length >= 6);
  // Tablas donde podría colarse: bitácoras, dispositivos, PIN, acciones delegadas, eventos.
  for (const table of [
    'auth_events',
    'devices',
    'offline_pins',
    'delegated_actions',
    'emergency_events',
    'emergency_sessions',
  ]) {
    const dump = JSON.stringify(await q(`SELECT * FROM ${table}`));
    for (const s of all) assert.ok(!dump.includes(s), `${table} contiene un secreto`);
  }
  // Respuestas posteriores: listados, auditoría, perfil y login.
  const later = [
    await api('admin', 'get', '/admin/devices?include_revoked=true'),
    await api('admin', 'get', `/admin/audit/delegated-actions?mission_id=${ARES1}&limit=200`),
    await api('vega', 'get', '/me'),
    await login('vega'),
    await api('orion', 'get', `/missions/${ARES1}/crew`),
  ];
  for (const res of later) {
    const text = JSON.stringify(res.body);
    for (const s of all) assert.ok(!text.includes(s), `${res.req.path} devuelve un secreto`);
    assert.ok(!/credential_hash|pin_hash|password_hash/.test(text), res.req.path);
  }
  // Ni en los logs del proceso (console.*) durante toda la suite.
  const logs = consoleLines.join(' | ');
  for (const s of all) assert.ok(!logs.includes(s), 'un secreto llegó a los logs');
});

// ---------------------------------------------------------------- extra: misión vigente

test('GET /missions/current: misión, entorno, rol y enlace (con un corte en curso)', async (t) => {
  if (skip(t)) return;
  const res = await api('orion', 'get', '/missions/current');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.mission.id, ARES1);
  assert.equal(res.body.mission.code, 'ARES-1');
  assert.equal(res.body.environment.code, 'mars_transit');
  assert.equal(res.body.crew_role, 'commander');
  assert.equal(res.body.comm.delay_seconds, 90);
  assert.equal(res.body.comm.link, 'up');
  const outage = await api('admin', 'post', '/admin/comm-outages', {
    mission_id: ARES1,
    starts_at: iso(Date.now() - 1000),
    ends_at: iso(Date.now() + 60 * 60 * 1000),
    reason: 'Corte de prueba (misión vigente)',
  });
  assert.equal(outage.status, 201, JSON.stringify(outage.body));
  const down = await api('lyra', 'get', '/missions/current');
  assert.equal(down.body.comm.link, 'down');
  assert.equal(down.body.comm.current_outage.id, outage.body.id);
  assert.equal(down.body.crew_role, 'flight_engineer');
  const ground = await api('reyes', 'get', `/missions/current?mission_id=${ARES1}`);
  assert.equal(ground.status, 200);
  assert.equal(ground.body.crew_role, null);
  assert.equal(
    (await api('reyes', 'get', `/missions/current?mission_id=${otherMissionId}`)).status,
    403,
  );
  assert.equal(
    (await api('admin', 'get', `/missions/current?mission_id=${otherMissionId}`)).status,
    200,
  );
  assert.equal((await tablet(TAB1, 'get', '/missions/current')).status, 401);
  await api('admin', 'patch', `/admin/comm-outages/${outage.body.id}`, { ends_at: iso() });
});
