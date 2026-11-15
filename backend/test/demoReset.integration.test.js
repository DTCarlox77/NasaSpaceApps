'use strict';
// Reinicio de demo (tarea 12) contra la base de PRUEBAS (DB_NAME_TEST), nunca la real:
// permisos y confirmación de POST /admin/demo/reset, qué deja (3 aptos y 1 no confirmado, sin
// emergencias, cortes, escalamientos ni solicitudes abiertas, usuarios listos), que no borra
// nada y que el check-in perdido no activa el triaje después de recargar.
const { openTestDb, resetDatabase } = require('./helpers/db'); // antes que cualquier src/
process.env.RATE_LIMIT_LOGIN_PER_MINUTE = '1000';
process.env.SIMULATOR_ENABLED = 'true';
process.env.TRIAGE_SWEEP_INTERVAL_S = '0';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const ARES1 = '20000000-0000-4000-8000-000000000001';
const A = {
  orion: '10000000-0000-4000-8000-000000000011',
  atlas: '10000000-0000-4000-8000-000000000014',
};
const HOUR = 3600 * 1000;

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
    orion: 'a.ortega',
    bh: 'bh.salas',
  })) {
    tokens[name] = await login(username);
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
const one = async (sql, params) => (await q(sql, params))[0];

async function login(username, password = 'Demo2026!') {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ username, password, device_id: 'tab-test' });
  if (res.status !== 200) return res;
  return res.body.access_token;
}
const reset = (who, body) => {
  const r = request(app).post('/api/v1/admin/demo/reset');
  if (who) r.set('Authorization', `Bearer ${tokens[who]}`);
  return r.send(body);
};
const totals = () =>
  one(`SELECT (SELECT count(*) FROM readings)::int AS readings,
              (SELECT count(*) FROM reading_evaluations)::int AS evaluations,
              (SELECT count(*) FROM escalations)::int AS escalations,
              (SELECT count(*) FROM emergency_sessions)::int AS sessions,
              (SELECT count(*) FROM emergency_events)::int AS events,
              (SELECT count(*) FROM support_requests)::int AS support,
              (SELECT count(*) FROM auth_events)::int AS auth_events,
              (SELECT count(*) FROM confidential_access_log)::int AS access_log,
              (SELECT count(*) FROM mission_comm_outages)::int AS outages`);
/**
 * Quién debe quedar "no confirmado": ATLAS, salvo que la historia le haya dado hoy su PVT
 * semanal de las 09:00 (día UTC + índice ≡ 5 mód 7; tripulación por call sign: ATLAS = 0) y
 * siga dentro de las 12 h (WELLBEING_FITNESS_MAX_AGE_H); entonces el siguiente, LYRA.
 */
function expectedNotConfirmed(now = new Date()) {
  const day = Math.floor(now.getTime() / (24 * HOUR));
  const hour = now.getUTCHours();
  return day % 7 === 5 && hour >= 9 && hour < 21 ? 'LYRA' : 'ATLAS';
}
const openSessions = async () =>
  (
    await one(
      `SELECT count(*)::int AS n FROM emergency_sessions WHERE status IN ('pending', 'active')`,
    )
  ).n;

test('sin confirmación (o con otra misión) → 400 y no toca nada', async (t) => {
  if (skip(t)) return;
  const before = await totals();
  for (const body of [{}, { confirm: 'ares-1' }, { confirm: 'ARES-2' }, { confirm: true }]) {
    const res = await reset('admin', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.equal(res.body.error.details[0].field, 'confirm');
  }
  const bad = await reset('admin', { confirm: 'ARES-1', days: 0 });
  assert.equal(bad.status, 400);
  assert.deepEqual(await totals(), before);
  assert.equal(
    (await q(`SELECT 1 FROM system_markers WHERE key = 'simulator_history_loaded_at'`)).length,
    0,
  );
});

test('solo admin: sin sesión 401; flight surgeon, astronauta y salud conductual 403', async (t) => {
  if (skip(t)) return;
  assert.equal((await reset(null, { confirm: 'ARES-1' })).status, 401);
  for (const who of ['reyes', 'orion', 'bh']) {
    const res = await reset(who, { confirm: 'ARES-1', days: 1 });
    assert.equal(res.status, 403, who);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  }
});

test('deja la demo lista: sin nada abierto, usuarios listos, 3 aptos y 1 no confirmado, sin borrar ni activar el triaje', async (t) => {
  if (skip(t)) return;
  const emergency = require('../src/services/emergency.service');

  // --- Una base "sucia", como después de ensayar:
  // historia de hace días: el barrido ve > 30 h sin check-in y abre la emergencia (el bug que
  // el reinicio evita);
  await emergency.markHistoryLoaded(new Date(Date.now() - 72 * HOUR));
  const swept = await emergency.runTriageSweep();
  assert.ok(swept.missed_checkin >= 1, 'sin el reinicio, el check-in perdido se dispara');
  assert.equal(await openSessions(), 1);
  // corte de enlace abierto;
  await q(
    `INSERT INTO mission_comm_outages (mission_id, starts_at, reason)
     VALUES ($1, now() - interval '2 minutes', 'ensayo')`,
    [ARES1],
  );
  // escalamientos físicos (SpO₂ crítica de hace 4 h: escala sin abrir emergencia) y uno
  // conductual; una solicitud de apoyo abierta;
  const critical = await request(app)
    .post('/api/v1/readings')
    .set('Authorization', `Bearer ${tokens.orion}`)
    .send({
      client_uuid: crypto.randomUUID(),
      indicator_code: 'SPO2',
      measured_at: new Date(Date.now() - 4 * HOUR).toISOString(),
      values: { value: 88 },
      input_method: 'wearable',
    });
  assert.equal(critical.status, 201);
  assert.equal(critical.body.emergency, undefined);
  await q(
    `INSERT INTO escalations (mission_id, astronaut_id, source_type, level, priority, reason,
                              deliver_at, is_confidential)
     VALUES ($1, $2, 'wellbeing', 'behavioral_health', 'routine', 'alerta de bienestar',
             now(), true)`,
    [ARES1, A.atlas],
  );
  const support = await request(app)
    .post('/api/v1/wellbeing/support-requests')
    .set('Authorization', `Bearer ${tokens.orion}`)
    .send({
      client_uuid: crypto.randomUUID(),
      urgency: 'now',
      channel: 'message',
      content: 'Ensayo (sintético)',
      created_at: new Date().toISOString(),
    });
  assert.equal(support.status, 201);
  // dr.reyes bloqueado y ATLAS con otra contraseña y sin el cambio obligatorio.
  await q(
    `UPDATE users SET failed_login_attempts = 5, locked_until = now() + interval '10 minutes'
     WHERE username = 'dr.reyes'`,
  );
  const passwords = require('../src/services/passwords.service');
  await q(
    `UPDATE users SET password_hash = $1, must_change_password = false, password_changed_at = now()
     WHERE username = 'm.silva'`,
    [await passwords.hash('OtraClave-2026!')],
  );
  const visibleOpen = (
    await one(
      `SELECT count(*)::int AS n FROM escalations
       WHERE status <> 'closed' AND NOT is_confidential AND category <> 'behavioral'`,
    )
  ).n;
  assert.ok(visibleOpen >= 2);
  const before = await totals();

  // --- Reinicio.
  const res = await reset('admin', { confirm: 'ARES-1', days: 2 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const body = res.body;
  assert.equal(body.mission_code, 'ARES-1');
  assert.ok(body.history.readings.created > 0);
  assert.equal(body.history.readings.rejected, 0);
  assert.equal(body.emergencies.closed, 1);
  assert.deepEqual(body.comm_outages, { closed: 1, scheduled_left: 0 });
  // Solo lo que admin puede ver: lo conductual se cierra, pero no se cuenta.
  assert.deepEqual(Object.keys(body.escalations), ['closed']);
  assert.equal(body.escalations.closed, visibleOpen);
  assert.ok(!('support_requests' in body));

  // Aptitud: 3 aptos y 1 no confirmado (ATLAS), en la respuesta y en el panel.
  const left = expectedNotConfirmed();
  assert.equal(body.not_confirmed, left);
  assert.deepEqual(
    body.fitness,
    Object.fromEntries(
      ['ATLAS', 'LYRA', 'ORION', 'VEGA'].map((cs) => [cs, cs === left ? 'not_confirmed' : 'fit']),
    ),
  );
  const dash = await request(app)
    .get('/api/v1/admin/dashboard/crew')
    .set('Authorization', `Bearer ${tokens.admin}`);
  assert.equal(dash.status, 200);
  const fitness = Object.fromEntries(dash.body.astronauts.map((a) => [a.call_sign, a.fitness]));
  assert.deepEqual(fitness, body.fitness);

  // Nada abierto.
  assert.equal(await openSessions(), 0);
  const cancelled = await one(
    `SELECT status, close_notes FROM emergency_sessions ORDER BY received_at LIMIT 1`,
  );
  assert.equal(cancelled.status, 'cancelled');
  assert.match(cancelled.close_notes, /Reinicio de demo/);
  assert.equal(
    (await one(`SELECT count(*)::int AS n FROM emergency_reports`)).n,
    1,
    'la sesión cerrada tiene su reporte',
  );
  assert.equal(
    (
      await one(
        `SELECT count(*)::int AS n FROM mission_comm_outages
         WHERE ends_at IS NULL OR ends_at > now()`,
      )
    ).n,
    0,
  );
  assert.equal(
    (await one(`SELECT count(*)::int AS n FROM escalations WHERE status <> 'closed'`)).n,
    0,
  );
  assert.equal(
    (await one(`SELECT count(*)::int AS n FROM support_requests WHERE status <> 'closed'`)).n,
    0,
  );
  // La bandeja del flight surgeon queda vacía (su sesión sigue: su contraseña no cambió).
  const inbox = await request(app)
    .get('/api/v1/admin/inbox')
    .set('Authorization', `Bearer ${tokens.reyes}`);
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.items.length, 0);

  // Usuarios listos: dr.reyes desbloqueado; ATLAS con Demo2026! y cambio obligatorio (428).
  const users = Object.fromEntries(body.users.map((u) => [u.username, u]));
  assert.equal(users['dr.reyes'].unlocked, true);
  assert.equal(users['dr.reyes'].password_restored, false);
  assert.equal(users['m.silva'].password_restored, true);
  assert.equal(users['m.silva'].must_change_password, true);
  assert.equal(users['a.ortega'].password_restored, false);
  const reyes = await login('dr.reyes');
  assert.equal(typeof reyes, 'string', 'dr.reyes entra');
  const atlas = await login('m.silva');
  assert.equal(atlas.status, 428, 'ATLAS sigue con cambio de contraseña obligatorio');
  const events = await q(
    `SELECT username, event FROM auth_events
     WHERE event IN ('account_unlocked', 'password_reset') ORDER BY created_at`,
  );
  assert.deepEqual(
    events.map((e) => `${e.username}:${e.event}`),
    ['dr.reyes:account_unlocked', 'm.silva:password_reset'],
  );

  // No borró nada (append-only): ningún conteo baja.
  const afterTotals = await totals();
  for (const [key, value] of Object.entries(before)) {
    assert.ok(afterTotals[key] >= value, `${key}: ${afterTotals[key]} < ${value}`);
  }

  // El check-in perdido no activa el triaje después de recargar: ni ahora ni 29 h después
  // (cuenta desde el reinicio). A las 31 h sí: la detección sigue encendida.
  const markerAt = new Date(body.triage.missed_checkin_counts_from).getTime();
  assert.ok(Math.abs(markerAt - Date.now()) < 5 * 60 * 1000);
  assert.equal((await emergency.runTriageSweep()).missed_checkin, 0);
  assert.equal(
    (await emergency.runTriageSweep(new Date(Date.now() + 29 * HOUR))).missed_checkin,
    0,
  );
  assert.equal(await openSessions(), 0);
  assert.ok((await emergency.runTriageSweep(new Date(Date.now() + 31 * HOUR))).missed_checkin >= 1);
});

test('repetido: idempotente y sigue dejando 3 aptos y 1 no confirmado', async (t) => {
  if (skip(t)) return;
  const res = await reset('admin', { confirm: 'ARES-1', days: 2 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  // La historia ya estaba: duplicate (solo puede sumar una hora del hábitat si cambió la hora).
  assert.ok(res.body.history.readings.duplicate > res.body.history.readings.created);
  assert.equal(res.body.history.readings.rejected, 0);
  assert.equal(res.body.emergencies.closed, 1, 'cierra la que abrió la prueba anterior (31 h)');
  assert.equal(res.body.not_confirmed, expectedNotConfirmed());
  assert.equal(Object.values(res.body.fitness).filter((f) => f === 'fit').length, 3);
  assert.equal(await openSessions(), 0);
  assert.ok(res.body.users.every((u) => !u.password_restored));
});

test('si los 4 ya tienen una PVT apta reciente, lo informa (no puede borrar)', async (t) => {
  if (skip(t)) return;
  // Los otros 3 tienen la PVT del reinicio anterior; el que quedó sin confirmar hace una ahora.
  const recorder = require('../src/services/wellbeingRecorder');
  const left = expectedNotConfirmed();
  const userOf = {
    ATLAS: '00000000-0000-4000-8000-000000000014',
    LYRA: '00000000-0000-4000-8000-000000000013',
  };
  const pvt = require('../src/simulator/profiles').profileFor(left).pvt;
  const run = await recorder.recordPvtRun({
    userId: userOf[left],
    run: {
      client_uuid: crypto.randomUUID(),
      device_id: 'TAB-1',
      before_critical_task: false,
      duration_s: 180,
      trials: 52,
      measured_at: new Date().toISOString(),
      readings: [
        { indicator_code: 'PVT_LAPSES', value: pvt.lapses[1], client_uuid: crypto.randomUUID() },
        { indicator_code: 'PVT_MEAN_RT', value: pvt.mean_rt[1], client_uuid: crypto.randomUUID() },
        {
          indicator_code: 'PVT_FALSE_STARTS',
          value: pvt.false_starts[1],
          client_uuid: crypto.randomUUID(),
        },
      ],
    },
  });
  assert.equal(run.fitness, 'fit');
  const res = await reset('admin', { confirm: 'ARES-1', days: 1 });
  assert.equal(res.status, 200);
  // Los 4 tenían una PVT apta reciente: no se puede dejar uno sin confirmar sin borrar.
  assert.equal(res.body.not_confirmed, null);
  assert.ok(res.body.notes.some((n) => /no se puede dejar uno sin confirmar/.test(n)));
  assert.equal(Object.values(res.body.fitness).filter((f) => f === 'fit').length, 4);
});
