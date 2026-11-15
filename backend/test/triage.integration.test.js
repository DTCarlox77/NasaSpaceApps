'use strict';
// Triaje Autónomo de Tripulación (tarea 9) contra la base de PRUEBAS: activación manual,
// por lectura crítica y por check-in perdido; hombre muerto; evaluación en el servidor con
// el mismo evaluador que el dispositivo; orden de atención; escalamiento con retraso y
// cortes; reporte al cerrar; preguntas a Tierra; emergency_* por sync (fusión); permisos.
const { openTestDb, resetDatabase } = require('./helpers/db'); // antes que cualquier src/
process.env.RATE_LIMIT_LOGIN_PER_MINUTE = '1000';
process.env.SIMULATOR_ENABLED = 'true';
process.env.SYNC_PULL_SETTLE_MS = '0';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const ARES1 = '20000000-0000-4000-8000-000000000001';
const A = {
  orion: '10000000-0000-4000-8000-000000000011',
  vega: '10000000-0000-4000-8000-000000000012',
  lyra: '10000000-0000-4000-8000-000000000013',
  atlas: '10000000-0000-4000-8000-000000000014',
};
const DEVICE = { orion: 'tab-orion', vega: 'tab-vega', lyra: 'tab-lyra' };
const DELAY = 90;
const CLINICAL = /triage_category|radiation_flag|"answers"|prodromal|vomiting/;
const WELLBEING = /WB_|PHQ2|GAD2|PVT_/;

let db = null;
let SKIP_REASON = '';
let request = null;
let app = null;
let emergency = null;
const tokens = {};

before(async () => {
  const opened = await openTestDb();
  db = opened.db;
  SKIP_REASON = opened.reason;
  if (!db) return;
  await resetDatabase();
  request = require('supertest');
  app = require('../src/app');
  emergency = require('../src/services/emergency.service');
  for (const [name, username] of Object.entries({
    admin: 'mission.control',
    reyes: 'dr.reyes',
    salas: 'bh.salas',
    orion: 'a.ortega',
    vega: 'k.mensah',
    lyra: 'l.tanaka',
  })) {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username, password: 'Demo2026!', device_id: DEVICE[name] || 'console-test' });
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
const api = (who, method, url, body) => {
  const r = request(app)[method](`/api/v1${url}`).set('Authorization', `Bearer ${tokens[who]}`);
  return body === undefined ? r : r.send(body);
};
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const later = (seconds) => new Date(Date.now() + seconds * 1000);

const openSessionRow = async () =>
  (
    await q(
      `SELECT id, status::text AS status, trigger_type::text AS trigger_type FROM emergency_sessions
       WHERE mission_id = $1 AND status IN ('pending', 'active')`,
      [ARES1],
    )
  )[0];

/** Deja la misión sin sesión abierta (la cierra o cancela el comandante). */
async function closeOpen(status = 'cancelled') {
  const open = await openSessionRow();
  if (!open) return;
  const res = await api('orion', 'post', `/emergency/sessions/${open.id}/close`, {
    closed_at: iso(),
    status,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

/** Lo que viaja a Tierra ya llegó (sin esperar el retraso). */
async function deliverToGround(sessionId) {
  await q(
    `UPDATE escalations SET created_at = created_at - interval '5 minutes',
                            deliver_at = deliver_at - interval '5 minutes'
     WHERE deliver_at IS NOT NULL AND (
       (source_type = 'emergency_session' AND source_id = $1)
       OR (source_type = 'emergency_assessment'
           AND source_id IN (SELECT id FROM emergency_assessments WHERE session_id = $1)))`,
    [sessionId],
  );
  await q(
    'UPDATE emergency_events SET deliver_at = created_at WHERE session_id = $1 AND deliver_at IS NOT NULL',
    [sessionId],
  );
}

function manualSession(extra = {}) {
  return {
    client_uuid: randomUUID(),
    trigger_type: 'manual_button',
    started_at: iso(),
    context: { solar_event_active: true, environment_alarm: null },
    responder_safe: { value: true },
    ...extra,
  };
}

const toAnswer = (value) =>
  Array.isArray(value) || typeof value === 'string' ? { choice: value } : { value };
const answerList = (answers) =>
  Object.entries(answers).map(([code, value]) => ({
    client_uuid: randomUUID(),
    question_code: code,
    answer: toAnswer(value),
    source: 'tap',
    answered_at: iso(),
  }));

/** Inicia, responde y completa una evaluación como ORION. */
async function assess(sessionId, astronautId, answers, deviceResult) {
  const created = await api('orion', 'post', `/emergency/sessions/${sessionId}/assessments`, {
    client_uuid: randomUUID(),
    astronaut_id: astronautId,
    sequence_no: 1,
    is_self_assessment: false,
    started_at: iso(),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const put = await api('orion', 'put', `/emergency/assessments/${created.body.id}/answers`, {
    answers: answerList(answers),
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const done = await api('orion', 'post', `/emergency/assessments/${created.body.id}/complete`, {
    completed_at: iso(),
    ...(deviceResult ? { device_result: deviceResult } : {}),
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return { id: created.body.id, preview: put.body.preview, result: done.body };
}

const UNRESPONSIVE = {
  responsive_and_mobile: false,
  breathing: true,
  resp_rate_over_30: false,
  perfusion_ok: true,
  follows_commands: false,
  vomiting_observed: true,
  time_to_vomiting_observed: 'lt_1h',
  consciousness_level: 'pain',
};
const YELLOW = {
  responsive_and_mobile: false,
  breathing: true,
  resp_rate_over_30: false,
  perfusion_ok: true,
  follows_commands: true,
  vomiting: false,
  prodromal_symptoms: ['none'],
};
const GREEN = { responsive_and_mobile: true, vomiting: false, prodromal_symptoms: ['none'] };

const postReading = (who, code, values, method = 'wearable') =>
  api(who, 'post', '/readings', {
    client_uuid: randomUUID(),
    indicator_code: code,
    measured_at: iso(),
    values,
    input_method: method,
  });

// ---------------------------------------------------------------- protocolo

test('GET /emergency/protocol: v2 activa, con fuentes; versiones anteriores por ?version', async (t) => {
  if (skip(t)) return;
  const res = await api('orion', 'get', '/emergency/protocol');
  assert.equal(res.status, 200);
  assert.equal(res.body.version, 2);
  assert.equal(res.body.is_active, true);
  assert.ok(res.body.sources.length >= 5);
  assert.ok(res.body.definition.questions.some((q) => q.code === 'vomiting_observed'));
  const v1 = await api('reyes', 'get', '/emergency/protocol?version=1');
  assert.equal(v1.body.version, 1);
  assert.equal(v1.body.is_active, false);
  assert.equal((await api('admin', 'get', '/emergency/protocol?version=99')).status, 404);
  assert.equal((await api('salas', 'get', '/emergency/protocol')).status, 403);
});

// ---------------------------------------------------------------- activación

test('activación manual: activa, escala a bordo y a Tierra; la segunda se une', async (t) => {
  if (skip(t)) return;
  await closeOpen(); // cada prueba empieza sin sesión abierta
  const body = manualSession();
  const res = await api('orion', 'post', '/emergency/sessions', body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.joined, false);
  const session = res.body.session;
  assert.equal(session.status, 'active');
  assert.equal(session.protocol.version, 2);
  assert.equal(session.next_step, 'start_assessments');
  assert.equal(res.body.roster.length, 4);
  assert.equal(res.body.attention_order.length, 4);

  const escalations = await q(
    `SELECT level::text AS level, priority::text AS priority, category, created_at, deliver_at
     FROM escalations WHERE source_type = 'emergency_session' AND source_id = $1 ORDER BY level`,
    [session.id],
  );
  assert.deepEqual(
    escalations.map((e) => [e.level, e.priority, e.category]),
    [
      ['crew', 'emergency', 'emergency'],
      ['flight_surgeon', 'emergency', 'emergency'],
    ],
  );
  const ground = escalations.find((e) => e.level === 'flight_surgeon');
  assert.equal((ground.deliver_at - ground.created_at) / 1000, DELAY);

  // Reintento: 200 con lo mismo.
  const again = await api('orion', 'post', '/emergency/sessions', body);
  assert.equal(again.status, 200);
  assert.equal(again.body.session.id, session.id);

  // Otra activación (VEGA, otro botón): se une a la abierta y queda en la línea de tiempo.
  const join = await api('vega', 'post', '/emergency/sessions', manualSession());
  assert.equal(join.status, 201);
  assert.equal(join.body.joined, true);
  assert.equal(join.body.session.id, session.id);
  assert.equal(join.body.session.joined_activations, 1);
  const events = await q(
    'SELECT event_type FROM emergency_events WHERE session_id = $1 ORDER BY id',
    [session.id],
  );
  assert.deepEqual(
    events.map((e) => e.event_type),
    ['opened', 'joined'],
  );
  const [merged] = await q(
    `SELECT status::text AS status, merged_into FROM emergency_sessions WHERE merged_into = $1`,
    [session.id],
  );
  assert.deepEqual(merged, { status: 'merged', merged_into: session.id });

  // Cerrar: solo comandante o CMO.
  const denied = await api('lyra', 'post', `/emergency/sessions/${session.id}/close`, {
    closed_at: iso(),
    status: 'closed',
  });
  assert.equal(denied.status, 403);
  await closeOpen('closed');
});

test('activación por lectura crítica: pending con hombre muerto; "estoy bien" la cancela', async (t) => {
  if (skip(t)) return;
  await closeOpen(); // cada prueba empieza sin sesión abierta
  const res = await postReading('lyra', 'SPO2', { value: 89 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.evaluation.level, 'critical');
  assert.equal(res.body.emergency.status, 'pending');
  assert.equal(res.body.emergency.trigger_type, 'critical_reading');
  const deadline = new Date(res.body.emergency.deadline_at).getTime();
  assert.ok(Math.abs(deadline - Date.now() - 60 * 1000) < 5000, 'TRIAGE_DEADMAN_S = 60');
  const sessionId = res.body.emergency.session_id;

  // Pending: todavía nada sale a Tierra por la sesión.
  const out = await q(
    `SELECT count(*)::int AS n FROM escalations WHERE source_type = 'emergency_session' AND source_id = $1`,
    [sessionId],
  );
  assert.equal(out[0].n, 0);
  // Solo el afectado confirma.
  assert.equal(
    (await api('vega', 'post', `/emergency/sessions/${sessionId}/confirm`, {})).status,
    409,
  );
  const ok = await api('lyra', 'post', `/emergency/sessions/${sessionId}/confirm`, {
    confirmed_at: iso(),
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.session.status, 'cancelled');
  assert.equal(ok.body.session.deadman[0].status, 'confirmed');
  const events = await q(
    'SELECT event_type FROM emergency_events WHERE session_id = $1 ORDER BY id',
    [sessionId],
  );
  assert.deepEqual(
    events.map((e) => e.event_type),
    ['opened', 'deadman_started', 'deadman_confirmed', 'cancelled'],
  );
  // Una lectura crítica vieja (más de TRIAGE_AUTO_READING_MAX_AGE_MIN) escala, pero no abre.
  const old = await api('lyra', 'post', '/readings', {
    client_uuid: randomUUID(),
    indicator_code: 'SPO2',
    measured_at: iso(Date.now() - 5 * 3600 * 1000),
    values: { value: 88 },
    input_method: 'wearable',
  });
  assert.equal(old.body.evaluation.level, 'critical');
  assert.equal(old.body.emergency, undefined);
  assert.equal(await openSessionRow(), undefined);
});

test('hombre muerto: vence → activa y escala una sola vez (barridos repetidos y en paralelo)', async (t) => {
  if (skip(t)) return;
  await closeOpen(); // cada prueba empieza sin sesión abierta
  const res = await postReading('vega', 'HEART_RATE', { value: 150, at_rest: true });
  assert.equal(res.body.evaluation.level, 'critical', JSON.stringify(res.body.evaluation));
  const sessionId = res.body.emergency.session_id;
  // Antes del plazo, el barrido no hace nada.
  assert.equal((await emergency.sweepDeadman(new Date())).activated, 0);
  const at = later(61);
  const [a, b] = await Promise.all([emergency.sweepDeadman(at), emergency.sweepDeadman(at)]);
  assert.equal(a.activated + b.activated, 1, 'nunca dispara dos veces');
  assert.equal((await emergency.sweepDeadman(later(120))).activated, 0);
  const [row] = await q(
    'SELECT status::text AS status, activated_at FROM emergency_sessions WHERE id = $1',
    [sessionId],
  );
  assert.equal(row.status, 'active');
  const escalations = await q(
    `SELECT level::text AS level FROM escalations
     WHERE source_type = 'emergency_session' AND source_id = $1 ORDER BY level`,
    [sessionId],
  );
  assert.deepEqual(
    escalations.map((e) => e.level),
    ['crew', 'flight_surgeon'],
  );
  // Ya venció: "estoy bien" llega tarde.
  const lateOk = await api('vega', 'post', `/emergency/sessions/${sessionId}/confirm`, {});
  assert.equal(lateOk.status, 409);
  assert.equal(lateOk.body.error.code, 'DEADMAN_EXPIRED');
  // El roster pone primero a quien no respondió.
  const view = await api('orion', 'get', `/emergency/sessions/${sessionId}`);
  assert.equal(view.body.roster[0].call_sign, 'VEGA');
  assert.match(view.body.roster[0].priority_reason, /estoy bien/);

  // Latido: si deja de llegar, escala una vez.
  const beat = await api('orion', 'post', `/emergency/sessions/${sessionId}/heartbeat`, {
    sent_at: iso(),
    device_id: 'TAB-1',
  });
  assert.equal(beat.status, 200, JSON.stringify(beat.body));
  assert.equal(beat.body.dead_man_switch_seconds, 120);
  assert.equal((await emergency.sweepDeadman(later(121))).heartbeat_lapsed, 1);
  assert.equal((await emergency.sweepDeadman(later(200))).heartbeat_lapsed, 0);
  await closeOpen('closed');
});

test('check-in perdido: la historia del seed y la del simulador no activan nada', async (t) => {
  if (skip(t)) return;
  await closeOpen(); // cada prueba empieza sin sesión abierta
  // Seed: sin marca de historia ni TRIAGE_AUTO_SINCE → no se detecta (aunque no haya check-ins).
  assert.equal(await emergency.detectMissedCheckins(later(100 * 3600)), 0);
  // Historia del simulador: deja la marca; dentro de TRIAGE_AUTO_MISSED_CHECKIN_H no activa.
  const history = await api('admin', 'post', '/admin/simulator/history', { days: 2, seed: 9 });
  assert.equal(history.status, 200, JSON.stringify(history.body));
  assert.equal(await emergency.detectMissedCheckins(new Date()), 0);
  assert.equal(await openSessionRow(), undefined, 'la historia sintética no abre emergencias');

  // 31 h después de la carga, ATLAS no hizo check-in (los demás sí): se activa solo por él.
  await q(`UPDATE system_markers SET at = now() - interval '31 hours'`);
  await q(`DELETE FROM emergency_deadman WHERE trigger_type = 'missed_checkin'`);
  await q(
    `UPDATE wellbeing_checkins SET measured_at = now() - interval '40 hours'
     WHERE astronaut_id = $1`,
    [A.atlas],
  );
  for (const astronaut of [A.orion, A.vega, A.lyra]) {
    await q(
      `INSERT INTO wellbeing_checkins (client_uuid, astronaut_id, measured_at) VALUES ($1, $2, now())`,
      [randomUUID(), astronaut],
    );
  }
  assert.equal(await emergency.detectMissedCheckins(new Date()), 1);
  const open = await openSessionRow();
  assert.equal(open.trigger_type, 'missed_checkin');
  assert.equal(open.status, 'pending');
  const deadman = await q('SELECT astronaut_id FROM emergency_deadman WHERE session_id = $1', [
    open.id,
  ]);
  assert.deepEqual(
    deadman.map((d) => d.astronaut_id),
    [A.atlas],
  );
  // Una vez por ausencia.
  assert.equal(await emergency.detectMissedCheckins(new Date()), 0);
  await closeOpen('cancelled');
});

// ---------------------------------------------------------------- evaluación

test('evaluación: el servidor da lo mismo que el evaluador del dispositivo; si no, lo marca', async (t) => {
  if (skip(t)) return;
  await closeOpen(); // cada prueba empieza sin sesión abierta
  const { evaluateAssessment } = require('../src/engine/triage');
  const protocol = (await api('orion', 'get', '/emergency/protocol')).body;
  const open = await api('orion', 'post', '/emergency/sessions', manualSession());
  const sessionId = open.body.session.id;
  const context = open.body.session.context;

  // Tripulante que no responde: solo preguntas observables (v2).
  const device = evaluateAssessment(
    protocol.definition,
    { responder_safe: true, ...UNRESPONSIVE },
    context,
  );
  const lyra = await assess(sessionId, A.lyra, UNRESPONSIVE, {
    status: device.status,
    triage_category: device.triage_category,
    radiation_flag: device.radiation_flag,
    rules_version: protocol.version,
  });
  assert.equal(lyra.result.status, 'completed');
  assert.equal(lyra.result.triage_category, device.triage_category);
  assert.equal(lyra.result.triage_category, 'red');
  assert.equal(lyra.result.radiation_flag, 'probable');
  assert.deepEqual(lyra.result.path, device.path);
  assert.equal(lyra.result.matches_device, true);
  assert.equal(lyra.result.computed_by, 'server');
  assert.equal(lyra.result.rules_version, 2);
  const asked = lyra.result.path.map((s) => s.split('=')[0]);
  for (const code of ['vomiting', 'time_to_vomiting', 'prodromal_symptoms']) {
    assert.equal(asked.includes(code), false, `no se pregunta ${code} a quien no responde`);
  }
  assert.ok(asked.includes('consciousness_level'));
  // Escalamientos de la evaluación: crew a bordo y Tierra con deliver_at.
  const levels = lyra.result.escalations.map((e) => [
    e.level,
    e.priority,
    Boolean(e.escalation_id),
  ]);
  assert.deepEqual(levels, [
    ['crew', 'emergency', true],
    ['flight_surgeon', 'emergency', true],
  ]);

  // La tableta calculó otra cosa: se guardan las dos y manda la del servidor.
  const vega = await assess(sessionId, A.vega, YELLOW, {
    status: 'completed',
    triage_category: 'green',
    radiation_flag: 'none',
    rules_version: 2,
  });
  assert.equal(vega.result.triage_category, 'yellow');
  assert.equal(vega.result.matches_device, false);
  assert.deepEqual(vega.result.mismatch_fields, ['triage_category']);
  const [stored] = await q(
    `SELECT triage_category::text AS triage_category, device_result, matches_device
     FROM emergency_assessments WHERE id = $1`,
    [vega.id],
  );
  assert.deepEqual(stored, {
    triage_category: 'yellow',
    device_result: {
      status: 'completed',
      triage_category: 'green',
      radiation_flag: 'none',
      rules_version: 2,
    },
    matches_device: false,
  });
  const mismatch = await q(
    `SELECT details FROM emergency_events WHERE assessment_id = $1 AND event_type = 'device_mismatch'`,
    [vega.id],
  );
  assert.equal(mismatch.length, 1);
  assert.equal(mismatch[0].details.used, 'server');

  // Incompleta: no se completa y dice qué falta.
  const partial = await api('orion', 'post', `/emergency/sessions/${sessionId}/assessments`, {
    client_uuid: randomUUID(),
    astronaut_id: A.atlas,
    sequence_no: 3,
    is_self_assessment: false,
    started_at: iso(),
  });
  await api('orion', 'put', `/emergency/assessments/${partial.body.id}/answers`, {
    answers: answerList({
      responsive_and_mobile: false,
      breathing: true,
      resp_rate_over_30: false,
    }),
  });
  const pending = await api('orion', 'post', `/emergency/assessments/${partial.body.id}/complete`, {
    completed_at: iso(),
  });
  assert.equal(pending.body.status, 'incomplete');
  assert.equal(pending.body.pending, 'perfusion_ok');
  // Vocabulario cerrado: una opción que no existe es 400.
  const bad = await api('orion', 'put', `/emergency/assessments/${partial.body.id}/answers`, {
    answers: [
      {
        client_uuid: randomUUID(),
        question_code: 'consciousness_level',
        answer: { choice: 'dormido' },
        source: 'tap',
        answered_at: iso(),
      },
    ],
  });
  assert.equal(bad.status, 400);
  // Completar otra vez es idempotente (no vuelve a escalar).
  const before = (await q('SELECT count(*)::int AS n FROM escalations'))[0].n;
  const again = await api('orion', 'post', `/emergency/assessments/${lyra.id}/complete`, {
    completed_at: iso(),
  });
  assert.equal(again.body.triage_category, 'red');
  assert.equal((await q('SELECT count(*)::int AS n FROM escalations'))[0].n, before);
  // Respuestas a una completada: 409 (se reevalúa).
  const closedAnswers = await api('orion', 'put', `/emergency/assessments/${lyra.id}/answers`, {
    answers: answerList({ consciousness_level: 'alert' }),
  });
  assert.equal(closedAnswers.status, 409);
  assert.equal(closedAnswers.body.error.code, 'ASSESSMENT_COMPLETED');
  await closeOpen('closed');
});

test('orden de atención con 3 tripulantes evaluados y reevaluación append-only', async (t) => {
  if (skip(t)) return;
  await closeOpen(); // cada prueba empieza sin sesión abierta
  const open = await api('orion', 'post', '/emergency/sessions', manualSession());
  const sessionId = open.body.session.id;
  await assess(sessionId, A.atlas, GREEN);
  await assess(sessionId, A.vega, YELLOW);
  const last = await assess(sessionId, A.lyra, UNRESPONSIVE);
  const order = last.result.attention_order.map((e) => [e.position, e.call_sign, e.status]);
  assert.deepEqual(order, [
    [1, 'LYRA', 'assessed'],
    [2, 'ORION', 'unassessed'],
    [3, 'VEGA', 'assessed'],
    [4, 'ATLAS', 'assessed'],
  ]);
  assert.match(last.result.attention_order[0].reason, /Rojo \(inmediato\), radiación probable/);
  assert.match(last.result.attention_order[1].reason, /Sin evaluar/);
  assert.match(last.result.attention_order[2].reason, /Amarillo/);
  assert.equal(last.result.next.call_sign, 'ORION', 'siguiente por evaluar');

  // ATLAS empeora: reevaluación. La anterior se conserva; manda la última.
  const re = await assess(sessionId, A.atlas, UNRESPONSIVE);
  const rows = await q(
    `SELECT id, reassessment_of, triage_category::text AS c FROM emergency_assessments
     WHERE session_id = $1 AND astronaut_id = $2 ORDER BY started_at`,
    [sessionId, A.atlas],
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[1].reassessment_of, rows[0].id);
  assert.deepEqual(
    rows.map((r) => r.c),
    ['green', 'red'],
  );
  const after = re.result.attention_order.map((e) => e.call_sign);
  assert.deepEqual(after.slice(0, 2).sort(), ['ATLAS', 'LYRA']);
  await closeOpen('closed');
});

// ---------------------------------------------------------------- Tierra

test('Tierra: escalamiento con deliver_at, cola durante un corte y reporte al cerrar', async (t) => {
  if (skip(t)) return;
  await closeOpen(); // cada prueba empieza sin sesión abierta
  const open = await api('orion', 'post', '/emergency/sessions', manualSession());
  const sessionId = open.body.session.id;
  // Antes de que llegue, Tierra no la ve.
  assert.equal((await api('reyes', 'get', `/admin/emergencies/${sessionId}`)).status, 404);
  const list0 = await api('reyes', 'get', '/admin/emergencies');
  assert.equal(
    list0.body.items.some((i) => i.id === sessionId),
    false,
  );

  await assess(sessionId, A.lyra, UNRESPONSIVE, {
    status: 'completed',
    triage_category: 'yellow',
    rules_version: 2,
  });
  await deliverToGround(sessionId);

  const outage = await api('admin', 'post', '/admin/comm-outages', {
    mission_id: ARES1,
    starts_at: iso(Date.now() - 1000),
    reason: 'Corte de prueba (triaje)',
  });
  assert.equal(outage.status, 201, JSON.stringify(outage.body));
  const queued = await assess(sessionId, A.vega, GREEN);
  const ground = queued.result.escalations.find((e) => e.level === 'flight_surgeon');
  assert.equal(ground.deliver_at, null, 'en cola durante el corte');
  const closed = await api('orion', 'post', `/emergency/sessions/${sessionId}/close`, {
    closed_at: iso(),
    status: 'closed',
    notes: 'LYRA estable en el refugio.',
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.deepEqual(closed.body.counts, {
    green: 1,
    yellow: 0,
    red: 1,
    black: 0,
    unreachable: 0,
    in_progress: 0,
  });
  const [closedEvent] = await q(
    `SELECT deliver_at FROM emergency_events WHERE session_id = $1 AND event_type = 'closed'`,
    [sessionId],
  );
  assert.equal(closedEvent.deliver_at, null, 'el cierre también espera enlace');
  const during = await api('reyes', 'get', `/admin/emergencies/${sessionId}`);
  assert.equal(during.status, 200);
  assert.equal(during.body.report, null, 'el reporte no llegó');
  assert.equal(during.body.session.status, 'closed');

  // Vuelve el enlace: lo que estaba en cola sale (llega tras el retraso).
  await api('admin', 'patch', `/admin/comm-outages/${outage.body.id}`, { ends_at: iso() });
  const [after] = await q(
    `SELECT deliver_at FROM emergency_events WHERE session_id = $1 AND event_type = 'closed'`,
    [sessionId],
  );
  assert.ok(after.deliver_at, 'ya tiene deliver_at');
  await deliverToGround(sessionId);
  const detail = await api('reyes', 'get', `/admin/emergencies/${sessionId}`);
  const report = detail.body.report;
  assert.ok(report, 'reporte completo');
  assert.deepEqual(report.protocol, { id: report.protocol.id, code: 'crew_emergency', version: 2 });
  assert.equal(report.assessments.length, 2);
  assert.ok(report.assessments.every((a) => Array.isArray(a.answers) && a.answers.length));
  assert.equal(report.differences.length, 1, 'la tableta de LYRA dijo amarillo');
  assert.equal(report.differences[0].used, 'server');
  assert.ok(report.timeline.some((e) => e.event_type === 'closed'));
  assert.equal(report.attention_order[0].call_sign, 'LYRA');
  assert.equal(WELLBEING.test(JSON.stringify(report)), false, 'sin bienestar en el reporte');
  assert.match(report.wellbeing, /No incluido/);
  // Lista con conteos para el flight surgeon.
  const list = await api('reyes', 'get', '/admin/emergencies?status=closed');
  const item = list.body.items.find((i) => i.id === sessionId);
  assert.ok(item);
  assert.equal(item.counts.red, 1);
});

test('admin: solo estado operativo; otros roles 403; nada de bienestar', async (t) => {
  if (skip(t)) return;
  await closeOpen(); // cada prueba empieza sin sesión abierta
  const [last] = await q(
    `SELECT id FROM emergency_sessions WHERE status = 'closed' AND mission_id = $1
     ORDER BY closed_at DESC LIMIT 1`,
    [ARES1],
  );
  const admin = await api('admin', 'get', `/admin/emergencies/${last.id}`);
  assert.equal(admin.status, 200);
  assert.equal(admin.body.report, null);
  assert.equal(admin.body.attention_order, undefined);
  assert.equal(CLINICAL.test(JSON.stringify(admin.body.assessments)), false);
  assert.equal(
    admin.body.timeline.some((e) => e.event_type === 'assessment_completed' && e.details),
    false,
  );
  const list = await api('admin', 'get', '/admin/emergencies');
  assert.ok(list.body.items.length > 0);
  assert.ok(list.body.items.every((i) => i.counts === null));
  // Bandeja: admin ve el aviso de la emergencia, sin la clasificación del triaje.
  const inbox = await api('admin', 'get', '/admin/inbox?category=emergency&limit=200');
  assert.equal(inbox.status, 200);
  assert.ok(inbox.body.items.length > 0);
  assert.ok(inbox.body.items.every((i) => i.triage === undefined));
  const fsInbox = await api('reyes', 'get', '/admin/inbox?category=emergency&limit=200');
  assert.ok(fsInbox.body.items.some((i) => i.triage && i.triage.triage_category));

  for (const who of ['salas', 'orion']) {
    assert.equal((await api(who, 'get', '/admin/emergencies')).status, 403, who);
    assert.equal((await api(who, 'get', `/admin/emergencies/${last.id}`)).status, 403, who);
  }
  assert.equal((await api('salas', 'get', `/emergency/sessions/${last.id}`)).status, 403);
  assert.equal(
    (await api('reyes', 'post', '/emergency/sessions', manualSession())).status,
    403,
    'Tierra no abre emergencias',
  );
  const fsDetail = await api('reyes', 'get', `/admin/emergencies/${last.id}`);
  assert.equal(WELLBEING.test(JSON.stringify(fsDetail.body)), false);
});

test('pregunta fuera del protocolo: viaja con deliver_at y la respuesta llega por pull después', async (t) => {
  if (skip(t)) return;
  await closeOpen(); // cada prueba empieza sin sesión abierta
  const open = await api('orion', 'post', '/emergency/sessions', manualSession());
  const sessionId = open.body.session.id;
  const question = await api('orion', 'post', `/emergency/sessions/${sessionId}/questions`, {
    client_uuid: randomUUID(),
    body: 'Fuera del protocolo: VEGA pide algo para la náusea. ¿Qué indican?',
    asked_at: iso(),
  });
  assert.equal(question.status, 201, JSON.stringify(question.body));
  const delay = (new Date(question.body.deliver_at) - new Date(question.body.created_at)) / 1000;
  assert.equal(delay, DELAY);
  await deliverToGround(sessionId);
  const detail = await api('reyes', 'get', `/admin/emergencies/${sessionId}`);
  // La pregunta llega a Tierra (deliver_at) cuando pasa el retraso.
  await q(
    "UPDATE escalation_messages SET created_at = created_at - interval '5 minutes', deliver_at = deliver_at - interval '5 minutes' WHERE id = $1",
    [question.body.id],
  );
  const detail2 = await api('reyes', 'get', `/admin/emergencies/${sessionId}`);
  assert.equal(
    detail.body.questions.some((m) => m.id === question.body.id),
    false,
  );
  assert.ok(detail2.body.questions.some((m) => m.id === question.body.id));

  // Tierra responde por la bandeja; a bordo llega por /sync/pull solo tras deliver_at.
  const { cursor } = (await api('vega', 'get', '/sync/pull?limit=200')).body;
  let next = cursor;
  for (let i = 0; i < 20; i += 1) {
    const page = await api('vega', 'get', `/sync/pull?limit=200&cursor=${next}`);
    next = page.body.cursor;
    if (!page.body.has_more) break;
  }
  const reply = await api(
    'reyes',
    'post',
    `/admin/escalations/${question.body.escalation_id}/messages`,
    {
      body: 'Recibido. Mantengan a VEGA hidratada y repitan signos vitales en 15 min.',
    },
  );
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  const early = await api('vega', 'get', `/sync/pull?cursor=${next}`);
  assert.equal(
    early.body.messages.some((m) => m.id === reply.body.id),
    false,
  );
  await q(
    `UPDATE escalation_messages SET created_at = created_at - interval '5 minutes',
                                    deliver_at = deliver_at - interval '5 minutes' WHERE id = $1`,
    [reply.body.id],
  );
  const arrived = await api('vega', 'get', `/sync/pull?cursor=${next}`);
  const message = arrived.body.messages.find((m) => m.id === reply.body.id);
  assert.ok(message, 'toda la tripulación recibe la respuesta de la emergencia');
  assert.equal(message.thread_id, question.body.escalation_id);
  await closeOpen('closed');
});

// ---------------------------------------------------------------- sync

test('sync: emergency_* con prioridad emergency, reintento duplicate y fusión de dos sesiones offline', async (t) => {
  if (skip(t)) return;
  await closeOpen(); // cada prueba empieza sin sesión abierta
  const now = Date.now();
  const at = (s) => iso(now - s * 1000);
  const orionSession = randomUUID();
  const orionAssessment = randomUUID();
  const orionBatch = {
    device_id: DEVICE.orion,
    sent_at: iso(now),
    items: [
      // Desordenados a propósito: el servidor procesa primero la sesión.
      {
        client_uuid: randomUUID(),
        entity: 'emergency_answer',
        priority: 'emergency',
        created_at: at(100),
        payload: {
          assessment_id: orionAssessment,
          question_code: 'responsive_and_mobile',
          answer: { value: true },
          source: 'voice',
          answered_at: at(100),
        },
      },
      {
        client_uuid: orionAssessment,
        entity: 'emergency_assessment',
        priority: 'emergency',
        created_at: at(110),
        payload: {
          session_id: orionSession,
          astronaut_id: A.lyra,
          sequence_no: 1,
          is_self_assessment: false,
          started_at: at(110),
        },
      },
      {
        client_uuid: orionSession,
        entity: 'emergency_session',
        priority: 'normal', // aunque venga normal, los emergency_* van primero
        created_at: at(120),
        payload: {
          trigger_type: 'manual_button',
          started_at: at(120),
          context: { solar_event_active: false },
          responder_safe: { value: true },
        },
      },
      {
        client_uuid: randomUUID(),
        entity: 'reading',
        priority: 'normal',
        created_at: at(130),
        payload: {
          indicator_code: 'BODY_TEMP',
          measured_at: at(130),
          values: { value: 36.8 },
          input_method: 'manual',
        },
      },
      {
        client_uuid: randomUUID(),
        entity: 'emergency_complete',
        priority: 'emergency',
        created_at: at(90),
        payload: {
          assessment_id: orionAssessment,
          completed_at: at(90),
          device_result: {
            status: 'completed',
            triage_category: 'green',
            radiation_flag: 'none',
            rules_version: 2,
          },
        },
      },
    ],
  };
  const first = await api('orion', 'post', '/sync/push', orionBatch);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const byEntity = Object.fromEntries(first.body.results.map((r) => [r.entity, r]));
  assert.ok(
    first.body.results.every((r) => r.status === 'accepted'),
    JSON.stringify(first.body.results),
  );
  assert.equal(byEntity.emergency_session.sequence, 1);
  assert.equal(byEntity.emergency_assessment.sequence, 2);
  assert.equal(byEntity.emergency_answer.sequence, 3);
  assert.equal(byEntity.emergency_complete.sequence, 4);
  assert.equal(byEntity.reading.sequence, 5);
  assert.equal(byEntity.emergency_complete.result.triage_category, 'green');
  assert.equal(byEntity.emergency_complete.result.matches_device, true);
  const primary = byEntity.emergency_session.server_id;

  // Reintento del lote completo: todo duplicate, sin filas nuevas.
  const counts = async () =>
    (
      await q(`SELECT (SELECT count(*) FROM emergency_sessions)::int AS s,
                     (SELECT count(*) FROM emergency_assessments)::int AS a,
                     (SELECT count(*) FROM emergency_answers)::int AS r,
                     (SELECT count(*) FROM escalations)::int AS e`)
    )[0];
  const before = await counts();
  const retry = await api('orion', 'post', '/sync/push', orionBatch);
  assert.ok(
    retry.body.results.every((r) => r.status === 'duplicate'),
    JSON.stringify(retry.body.results),
  );
  assert.deepEqual(await counts(), before);

  // VEGA abrió otra sesión sin conexión en su tableta: se fusiona con la de ORION.
  const vegaSession = randomUUID();
  const vegaAssessment = randomUUID();
  const vegaBatch = {
    device_id: DEVICE.vega,
    sent_at: iso(),
    items: [
      {
        client_uuid: vegaSession,
        entity: 'emergency_session',
        priority: 'emergency',
        created_at: at(115),
        payload: {
          trigger_type: 'crew_event',
          started_at: at(115),
          context: {},
          responder_safe: { value: true },
        },
      },
      {
        client_uuid: vegaAssessment,
        entity: 'emergency_assessment',
        priority: 'emergency',
        created_at: at(105),
        payload: {
          session_client_uuid: vegaSession,
          astronaut_id: A.atlas,
          sequence_no: 1,
          is_self_assessment: false,
          started_at: at(105),
        },
      },
      {
        client_uuid: randomUUID(),
        entity: 'emergency_answer',
        priority: 'emergency',
        created_at: at(95),
        payload: {
          assessment_id: vegaAssessment,
          question_code: 'responsive_and_mobile',
          answer: { value: true },
          source: 'tap',
          answered_at: at(95),
        },
      },
      {
        client_uuid: randomUUID(),
        entity: 'emergency_complete',
        priority: 'emergency',
        created_at: at(85),
        payload: { assessment_id: vegaAssessment, completed_at: at(85) },
      },
    ],
  };
  const merged = await api('vega', 'post', '/sync/push', vegaBatch);
  assert.ok(
    merged.body.results.every((r) => r.status === 'accepted'),
    JSON.stringify(merged.body.results),
  );
  const session = merged.body.results[0].result;
  assert.equal(session.joined, true);
  assert.equal(session.merged_into, primary);
  assert.equal(session.session_id, primary);
  // Nada se descarta: la evaluación de VEGA quedó en la sesión principal.
  const [atlasAssessment] = await q(
    'SELECT session_id FROM emergency_assessments WHERE client_uuid = $1',
    [vegaAssessment],
  );
  assert.equal(atlasAssessment.session_id, primary);
  const view = await api('orion', 'get', `/emergency/sessions/${primary}`);
  assert.equal(view.body.assessments.length, 2);
  assert.equal(view.body.session.joined_activations, 1);
  const [row] = await q(
    'SELECT status::text AS status, merged_into FROM emergency_sessions WHERE client_uuid = $1',
    [vegaSession],
  );
  assert.deepEqual(row, { status: 'merged', merged_into: primary });

  // Cierre por sync (comandante) y reintento.
  const closeItem = {
    client_uuid: randomUUID(),
    entity: 'emergency_close',
    priority: 'emergency',
    created_at: iso(),
    payload: { session_id: orionSession, closed_at: iso(), status: 'closed' },
  };
  const close = await api('orion', 'post', '/sync/push', {
    device_id: DEVICE.orion,
    sent_at: iso(),
    items: [closeItem],
  });
  assert.equal(close.body.results[0].status, 'accepted', JSON.stringify(close.body.results));
  const closeAgain = await api('orion', 'post', '/sync/push', {
    device_id: DEVICE.orion,
    sent_at: iso(),
    items: [closeItem],
  });
  assert.equal(closeAgain.body.results[0].status, 'duplicate');
  assert.equal(await openSessionRow(), undefined);
});

// ---------------------------------------------------------------- simulador

test('simulador: emergency_solar corre de punta a punta', async (t) => {
  if (skip(t)) return;
  await closeOpen(); // cada prueba empieza sin sesión abierta
  const res = await api('admin', 'post', '/admin/simulator/scenarios/emergency_solar', {});
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const e = res.body.emergency;
  assert.equal(e.status, 'closed');
  assert.equal(e.trigger_type, 'critical_reading');
  assert.ok(e.deadman.activated >= 1);
  assert.deepEqual(
    e.assessments.map((a) => [a.call_sign, a.triage_category, a.matches_device]),
    [
      ['VEGA', 'green', true],
      ['LYRA', 'red', true],
      ['ATLAS', 'green', true],
    ],
  );
  assert.equal(e.attention_order[0].call_sign, 'LYRA');
  assert.equal(e.question.deliver_at, null, 'la pregunta salió durante el corte');
  assert.equal(e.outage.report_queued, true);
  assert.ok(e.report_deliver_at, 'al cerrar el corte, el reporte sale');
  const report = await q('SELECT report FROM emergency_reports WHERE session_id = $1', [
    e.session_id,
  ]);
  assert.equal(report.length, 1);
  assert.equal(WELLBEING.test(JSON.stringify(report[0].report)), false);
});
