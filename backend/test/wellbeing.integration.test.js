'use strict';
// Módulo Bienestar (tarea 10) contra la base de PRUEBAS: check-in diario (línea base, z,
// corrección del mismo día, duplicados, racha), escalamiento confidencial a behavioral_health
// (uno abierto por indicador), "Quiero hablar con alguien" (ruta, sync, retraso y cortes),
// bandeja y detalle de salud conductual con bitácora, cumplimiento para admin, aptitud con PVT
// reciente, PHQ-2/GAD-2 y quién ve qué. El paso del tiempo se simula moviendo las fechas hacia
// atrás (sin sleeps).
const { openTestDb, resetDatabase } = require('./helpers/db'); // antes que cualquier src/
process.env.RATE_LIMIT_LOGIN_PER_MINUTE = '1000';
process.env.SYNC_PULL_SETTLE_MS = '0';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const catalog = require('../docs/catalogo-indicadores.json');

const ARES1 = '20000000-0000-4000-8000-000000000001';
const A = {
  orion: '10000000-0000-4000-8000-000000000011',
  vega: '10000000-0000-4000-8000-000000000012',
  lyra: '10000000-0000-4000-8000-000000000013',
};
const USERS = {
  admin: 'mission.control',
  reyes: 'dr.reyes',
  bh: 'bh.salas',
  orion: 'a.ortega',
  vega: 'k.mensah',
  lyra: 'l.tanaka',
};
const DEVICE = { orion: 'tab-orion', vega: 'tab-vega', lyra: 'tab-lyra' };
const DAY = 24 * 60 * 60 * 1000;
const CONFIDENTIAL = /WB_|PVT_|PHQ|GAD/;
const NOTE = 'NOTA-PRIVADA-DE-LYRA';
const recommendation = (code, level, escalation) =>
  catalog.indicators
    .find((i) => i.code === code)
    .rules.find((r) => r.level === level && r.escalation === escalation).recommendation;
const MSG = {
  unrated: recommendation('WB_MOOD', 'unrated', 'self_care'),
  normal: recommendation('WB_MOOD', 'normal', 'self_care'),
  selfCare: recommendation('WB_MOOD', 'caution', 'self_care'),
  toBh: recommendation('WB_MOOD', 'caution', 'behavioral_health'),
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
  for (const [name, username] of Object.entries(USERS)) {
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
const iso = (ms) => new Date(ms).toISOString();
/** Hace `k` días (un minuto antes de esta hora): un día UTC distinto por k. */
const daysAgo = (k) => iso(Date.now() - k * DAY - 60 * 1000);

const sliders = (mood, other) => ({ mood, fatigue: other, stress: other, crew_conflict: other });
const checkin = (who, k, values, extra = {}) =>
  api(who, 'post', '/wellbeing/checkins', {
    client_uuid: randomUUID(),
    measured_at: daysAgo(k),
    sleep_hours: 7.4,
    ...values,
    ...extra,
  });

/** Lo que está en camino a Tierra "llega": se mueven las fechas hacia atrás. */
async function arriveEscalations(astronautId) {
  await q(
    `UPDATE escalations SET created_at = created_at - interval '3 minutes',
                            deliver_at = deliver_at - interval '3 minutes'
     WHERE astronaut_id = $1 AND deliver_at > now()`,
    [astronautId],
  );
}
const arriveRequest = (id) =>
  q(
    `UPDATE support_requests SET received_at = received_at - interval '3 minutes',
                                 deliver_at = deliver_at - interval '3 minutes' WHERE id = $1`,
    [id],
  );
const arriveMessage = (id) =>
  q(
    `UPDATE support_messages SET created_at = created_at - interval '3 minutes',
                                 deliver_at = deliver_at - interval '3 minutes' WHERE id = $1`,
    [id],
  );

const behavioralEscalations = (astronautId) =>
  q(
    `SELECT e.id, e.level::text AS level, e.status::text AS status, e.is_confidential,
            e.category, e.reason, e.created_at, e.deliver_at, r.indicator_code
     FROM escalations e JOIN readings r ON r.id = e.source_id
     WHERE e.astronaut_id = $1 AND e.category = 'behavioral'
     ORDER BY e.created_at, r.indicator_code`,
    [astronautId],
  );
const accessLog = () => q('SELECT * FROM confidential_access_log ORDER BY accessed_at, id');

// Serie de LYRA (verificada con src/engine/derived.js): 10 días de línea base y 6 peores.
// El 5.º día peor deja adverse_sustained_days = 5 en los cuatro deslizadores.
const BASE_MOOD = [70, 72, 68, 71, 69, 73, 70, 67, 71, 70];
const BASE_OTHER = [30, 28, 32, 29, 31, 30, 27, 33, 30, 29];
const BAD_MOOD = [38, 38, 22, 22, 22, 22];
const BAD_OTHER = [62, 62, 78, 78, 78, 78];
const ACK_KEYS = [
  'client_uuid',
  'id',
  'message',
  'offer_support',
  'received_at',
  'screening_due',
  'streak',
  'supersedes_id',
];

// ---------------------------------------------------------------- check-in y escalamiento

test('check-in sin línea base: unrated y mensaje neutro (sin nivel ni puntaje)', async (t) => {
  if (skip(t)) return;
  for (let i = 0; i < BASE_MOOD.length; i += 1) {
    const res = await checkin('lyra', 15 - i, sliders(BASE_MOOD[i], BASE_OTHER[i]));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(Object.keys(res.body).sort(), ACK_KEYS);
    assert.equal(res.body.message, i < 9 ? MSG.unrated : MSG.normal, `día ${i}`);
    assert.equal(res.body.offer_support, true);
    assert.equal(res.body.supersedes_id, null);
  }
  const first = await q(
    `SELECT e.level FROM readings r JOIN reading_evaluations e ON e.reading_id = r.id
     WHERE r.astronaut_id = $1 AND r.indicator_code LIKE 'WB_%'
     ORDER BY r.measured_at LIMIT 4`,
    [A.lyra],
  );
  assert.deepEqual(
    first.map((r) => r.level),
    ['unrated', 'unrated', 'unrated', 'unrated'],
  );
  assert.equal((await behavioralEscalations(A.lyra)).length, 0);
});

test('5 check-ins sostenidos → escalamiento confidencial a behavioral_health con retraso; no se repite mientras siga abierto', async (t) => {
  if (skip(t)) return;
  const messages = [];
  for (let i = 0; i < 5; i += 1) {
    const res = await checkin('lyra', 5 - i, sliders(BAD_MOOD[i], BAD_OTHER[i]));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    messages.push(res.body.message);
    const rows = await behavioralEscalations(A.lyra);
    assert.equal(rows.length, i < 4 ? 0 : 4, `día peor ${i + 1}`);
    if (i === 4) {
      // La racha cuenta los 15 días seguidos, con resultado bueno o malo.
      assert.equal(res.body.streak.streak_days, 15);
    }
  }
  assert.deepEqual(messages, [MSG.normal, MSG.normal, MSG.selfCare, MSG.selfCare, MSG.toBh]);
  const rows = await behavioralEscalations(A.lyra);
  assert.deepEqual(rows.map((r) => r.indicator_code).sort(), [
    'WB_CREW_CONFLICT',
    'WB_FATIGUE',
    'WB_MOOD',
    'WB_STRESS',
  ]);
  for (const r of rows) {
    assert.equal(r.level, 'behavioral_health');
    assert.equal(r.is_confidential, true);
    assert.equal(r.status, 'queued');
    assert.equal(r.deliver_at - r.created_at, 90 * 1000, 'retraso de ARES-1 (compute_deliver_at)');
    assert.ok(!/\d/.test(r.reason.replace(/WB_\w+/, '')), 'el motivo no lleva el valor');
  }

  // 6.º día (hoy), todavía sostenido: no vuelve a escalar; la evaluación apunta al abierto.
  const today = await checkin('lyra', 0, sliders(BAD_MOOD[5], BAD_OTHER[5]));
  assert.equal(today.status, 201);
  assert.equal(today.body.message, MSG.toBh);
  assert.equal(today.body.streak.streak_days, 16);
  assert.equal((await behavioralEscalations(A.lyra)).length, 4, 'uno abierto por indicador');
  const linked = await q(
    `SELECT e.escalation_id FROM readings r JOIN reading_evaluations e ON e.reading_id = r.id
     WHERE r.wellbeing_checkin_id = $1 AND r.indicator_code = 'WB_MOOD'`,
    [today.body.id],
  );
  assert.equal(linked[0].escalation_id, rows.find((r) => r.indicator_code === 'WB_MOOD').id);

  // Corrección del mismo día (con nota privada): tampoco escala.
  const fix = await checkin('lyra', 0, sliders(BAD_MOOD[5], BAD_OTHER[5]), {
    private_note: NOTE,
  });
  assert.equal(fix.status, 201);
  assert.equal(fix.body.supersedes_id, today.body.id);
  assert.equal((await behavioralEscalations(A.lyra)).length, 4);

  // behavioral_health cierra el de ánimo: el siguiente check-in sostenido sí vuelve a escalar
  // (solo ese indicador).
  await arriveEscalations(A.lyra);
  const mood = rows.find((r) => r.indicator_code === 'WB_MOOD');
  const closed = await api('bh', 'post', `/admin/behavioral/escalations/${mood.id}/close`);
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.status, 'closed');
  const again = await checkin('lyra', 0, sliders(BAD_MOOD[5], BAD_OTHER[5]), {
    private_note: NOTE,
  });
  assert.equal(again.body.supersedes_id, fix.body.id);
  const after = await behavioralEscalations(A.lyra);
  assert.equal(after.length, 5);
  assert.deepEqual(
    after
      .filter((r) => r.status !== 'closed')
      .map((r) => r.indicator_code)
      .sort(),
    ['WB_CREW_CONFLICT', 'WB_FATIGUE', 'WB_MOOD', 'WB_STRESS'],
  );
  // Nunca a la tripulación ni al flight surgeon (el catálogo no escala WB_* a él).
  assert.ok(after.every((r) => r.level === 'behavioral_health'));
});

test('check-in duplicado → 200 duplicate (en línea y por sync); segundo del mismo día → corrección', async (t) => {
  if (skip(t)) return;
  const body = {
    client_uuid: randomUUID(),
    measured_at: daysAgo(1),
    ...sliders(65, 30),
  };
  const first = await api('orion', 'post', '/wellbeing/checkins', body);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.screening_due, true, 'todavía no hizo PHQ-2 ni GAD-2');
  const dup = await api('orion', 'post', '/wellbeing/checkins', body);
  assert.equal(dup.status, 200);
  assert.equal(dup.body.id, first.body.id);
  assert.equal(dup.body.message, first.body.message);
  // Sin sleep_hours (la pulsera es opcional): se acepta.
  const { rows: counted } = await db.pool.query(
    `SELECT count(*)::int AS n FROM readings WHERE wellbeing_checkin_id = $1`,
    [first.body.id],
  );
  assert.equal(counted[0].n, 4, 'sin lectura de sueño');

  // Por sync, el mismo client_uuid es duplicate con el mismo id.
  const item = (clientUuid, payload) => ({
    client_uuid: clientUuid,
    entity: 'wellbeing_checkin',
    priority: 'normal',
    created_at: iso(Date.now()),
    payload,
  });
  const payload = { ...body };
  delete payload.client_uuid; // por sync va en el item
  const push = await api('orion', 'post', '/sync/push', {
    device_id: DEVICE.orion,
    sent_at: iso(Date.now()),
    items: [item(body.client_uuid, payload)],
  });
  assert.equal(push.status, 200, JSON.stringify(push.body));
  assert.equal(push.body.results[0].status, 'duplicate');
  assert.equal(push.body.results[0].server_id, first.body.id);

  // Otro check-in el mismo día (en línea): corrige el anterior (append-only).
  const second = await api('orion', 'post', '/wellbeing/checkins', {
    ...body,
    client_uuid: randomUUID(),
    ...sliders(55, 40),
    sleep_hours: 6.9,
  });
  assert.equal(second.status, 201);
  assert.equal(second.body.supersedes_id, first.body.id);
  const superseded = await q(
    `SELECT count(*)::int AS n FROM readings r
     WHERE r.wellbeing_checkin_id = $1
       AND EXISTS (SELECT 1 FROM readings s WHERE s.recorded_by = r.recorded_by
                   AND s.supersedes_uuid = r.client_uuid)`,
    [first.body.id],
  );
  assert.equal(superseded[0].n, 4, 'los 4 deslizadores del primero quedaron corregidos');

  // Y un tercero por sync corrige al segundo.
  const third = await api('orion', 'post', '/sync/push', {
    device_id: DEVICE.orion,
    sent_at: iso(Date.now()),
    items: [item(randomUUID(), { ...payload, ...sliders(60, 35) })],
  });
  assert.equal(third.body.results[0].status, 'accepted', JSON.stringify(third.body));
  assert.equal(third.body.results[0].result.supersedes_id, second.body.id);
  assert.equal(third.body.results[0].result.offer_support, true);
  assert.ok(!('level' in third.body.results[0].result));
  const current = await q(
    `SELECT count(*)::int AS n FROM wellbeing_checkins c
     WHERE c.astronaut_id = $1 AND NOT EXISTS (SELECT 1 FROM wellbeing_checkins n
                                               WHERE n.supersedes_id = c.id)`,
    [A.orion],
  );
  assert.equal(current[0].n, 1, 'un check-in vigente por día');

  // Validación con los nombres del contrato.
  const bad = await api('orion', 'post', '/wellbeing/checkins', {
    ...body,
    client_uuid: randomUUID(),
    mood: 101,
  });
  assert.equal(bad.status, 400);
  assert.deepEqual(
    bad.body.error.details.map((d) => d.field),
    ['mood'],
  );
});

test('la racha no depende del resultado', async (t) => {
  if (skip(t)) return;
  // ORION: un check-in "normal" hoy después del de ayer → 2. LYRA, con resultado que escala,
  // ya lleva 16: los dos cuentan solo días con check-in.
  const res = await checkin('orion', 0, sliders(66, 31));
  assert.equal(res.status, 201);
  assert.equal(res.body.streak.streak_days, 2);
  const lyra = await checkin('lyra', 0, sliders(BAD_MOOD[5], BAD_OTHER[5]), {
    private_note: NOTE,
  });
  assert.equal(lyra.body.streak.streak_days, 16);
  assert.equal(lyra.body.streak.checkins_this_week, 7);
  assert.equal(lyra.body.streak.checkins_goal_week, 7);
});

test('la nota privada solo la ve el astronauta: behavioral_health ve valores, z y tendencias', async (t) => {
  if (skip(t)) return;
  const detail = await api('bh', 'get', `/admin/behavioral/astronauts/${A.lyra}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  const text = JSON.stringify(detail.body);
  assert.ok(!text.includes(NOTE), 'sin la nota');
  assert.ok(!text.includes('private_note'));
  assert.equal(detail.body.astronaut.call_sign, 'LYRA');
  assert.equal(detail.body.baseline_ready, true);
  const mood = detail.body.indicators.find((i) => i.code === 'WB_MOOD');
  assert.equal(mood.level, 'caution');
  assert.equal(mood.escalation, 'behavioral_health');
  assert.equal(mood.last_value, 22);
  assert.ok(mood.adverse_z_3d >= 1.5);
  assert.ok(mood.adverse_sustained_days >= 5);
  assert.equal(mood.trend, 'falling');
  assert.ok(mood.series.length >= 10);
  assert.ok(detail.body.checkins.length >= 10);
  assert.equal(detail.body.checkins[0].mood, 22);
  // Abiertos y ya en Tierra: 3 (el de ánimo se cerró; el nuevo todavía viaja).
  assert.deepEqual(detail.body.escalations.map((e) => e.indicator_code).sort(), [
    'WB_CREW_CONFLICT',
    'WB_FATIGUE',
    'WB_STRESS',
  ]);

  // El astronauta sí ve su nota (y nunca un nivel ni un puntaje).
  const mine = await api('lyra', 'get', '/me/wellbeing?limit=5');
  assert.equal(mine.status, 200);
  assert.equal(mine.body.items[0].kind, 'checkin');
  assert.equal(mine.body.items[0].checkin.private_note, NOTE);
  assert.ok(!/"level"|"score"|"escalation"/.test(JSON.stringify(mine.body)));
  assert.ok(mine.body.next_cursor);
  const page2 = await api('lyra', 'get', `/me/wellbeing?limit=5&cursor=${mine.body.next_cursor}`);
  assert.equal(page2.status, 200);
  const ids = new Set(mine.body.items.map((i) => i.id));
  assert.ok(page2.body.items.every((i) => !ids.has(i.id)));
});

// ---------------------------------------------------------------- "Quiero hablar con alguien"

let vegaRequest = null;

test('support_request por la ruta y por sync; la respuesta llega por pull solo tras deliver_at y nunca durante un corte', async (t) => {
  if (skip(t)) return;
  const start = await api('vega', 'get', '/sync/pull?limit=200');
  const cursor = start.body.cursor;
  const body = {
    client_uuid: randomUUID(),
    urgency: 'today',
    channel: 'message',
    content: 'Llevo varios días durmiendo mal.',
    created_at: iso(Date.now() - 1000),
  };
  const created = await api('vega', 'post', '/wellbeing/support-requests', body);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  vegaRequest = created.body;
  assert.equal(created.body.status, 'open');
  assert.deepEqual(created.body.suggestions, []);
  assert.equal(
    new Date(created.body.deliver_at) - new Date(created.body.received_at),
    90 * 1000,
    'viaja con el retraso de ARES-1',
  );
  const dup = await api('vega', 'post', '/wellbeing/support-requests', body);
  assert.equal(dup.status, 200);
  assert.equal(dup.body.id, created.body.id);

  // Antes de que llegue: Tierra no la ve ni puede responder.
  const early = await api('bh', 'get', '/admin/behavioral/inbox');
  assert.ok(early.body.items.every((i) => i.id !== created.body.id));
  const tooSoon = await api(
    'bh',
    'post',
    `/admin/behavioral/support-requests/${created.body.id}/messages`,
    {
      body: 'Hola',
    },
  );
  assert.equal(tooSoon.status, 404);

  await arriveRequest(created.body.id);
  const inbox = await api('bh', 'get', '/admin/behavioral/inbox');
  const item = inbox.body.items.find((i) => i.id === created.body.id);
  assert.ok(item, JSON.stringify(inbox.body));
  assert.equal(item.kind, 'support_request');
  assert.equal(item.urgency, 'today');
  assert.equal(item.status, 'open');
  assert.ok(item.deliver_at && item.measured_at);

  const reply = await api(
    'bh',
    'post',
    `/admin/behavioral/support-requests/${created.body.id}/messages`,
    {
      body: '¿Hablamos mañana a las 15:00 UTC?',
    },
  );
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.equal(reply.body.direction, 'to_crew');
  assert.equal(reply.body.author_role, 'behavioral_health');
  assert.ok(new Date(reply.body.deliver_at) > new Date(), 'en camino');
  const [state] = await q('SELECT status FROM support_requests WHERE id = $1', [created.body.id]);
  assert.equal(state.status, 'acknowledged', 'responder cuenta como acuse');

  const supportMessages = (pullBody) =>
    pullBody.messages.filter((m) => m.channel === 'support').map((m) => m.id);
  const before = await api('vega', 'get', `/sync/pull?limit=200&cursor=${cursor}`);
  assert.deepEqual(supportMessages(before.body), [], 'todavía no llega');
  await arriveMessage(reply.body.id);
  const arrived = await api('vega', 'get', `/sync/pull?limit=200&cursor=${cursor}`);
  assert.deepEqual(supportMessages(arrived.body), [reply.body.id]);
  const msg = arrived.body.messages.find((m) => m.id === reply.body.id);
  assert.equal(msg.thread_id, created.body.id);
  const thread = await api(
    'vega',
    'get',
    `/wellbeing/support-requests/${created.body.id}/messages`,
  );
  assert.equal(thread.status, 200);
  assert.deepEqual(
    thread.body.items.map((m) => m.id),
    [reply.body.id],
  );

  // Corte de enlace abierto: la respuesta queda en cola (deliver_at null) y no sale en el pull.
  const outage = await api('admin', 'post', '/admin/comm-outages', {
    mission_id: ARES1,
    starts_at: iso(Date.now() - 1000),
    reason: 'Corte de prueba (bienestar)',
  });
  assert.equal(outage.status, 201, JSON.stringify(outage.body));
  const queued = await api(
    'bh',
    'post',
    `/admin/behavioral/support-requests/${created.body.id}/messages`,
    {
      body: 'Sigo aquí.',
    },
  );
  assert.equal(queued.status, 201);
  assert.equal(queued.body.deliver_at, null, 'en cola durante el corte');
  const during = await api('vega', 'get', `/sync/pull?limit=200&cursor=${arrived.body.cursor}`);
  assert.deepEqual(supportMessages(during.body), []);
  const closeOutage = await api('admin', 'patch', `/admin/comm-outages/${outage.body.id}`, {
    ends_at: iso(Date.now()),
  });
  assert.equal(closeOutage.status, 200, JSON.stringify(closeOutage.body));
  const [requeued] = await q('SELECT deliver_at FROM support_messages WHERE id = $1', [
    queued.body.id,
  ]);
  assert.ok(requeued.deliver_at > new Date(), 'sale al volver el enlace, con el retraso');
  const stillComing = await api(
    'vega',
    'get',
    `/sync/pull?limit=200&cursor=${arrived.body.cursor}`,
  );
  assert.deepEqual(supportMessages(stillComing.body), []);
  await arriveMessage(queued.body.id);
  const finally_ = await api('vega', 'get', `/sync/pull?limit=200&cursor=${arrived.body.cursor}`);
  assert.deepEqual(supportMessages(finally_.body), [queued.body.id]);

  // Por sync: accepted, reintento duplicate, mismo client_uuid con otro contenido → conflict.
  const syncItem = (clientUuid, payload) => ({
    client_uuid: clientUuid,
    entity: 'support_request',
    priority: 'normal',
    created_at: iso(Date.now()),
    payload,
  });
  const syncUuid = randomUUID();
  const payload = {
    urgency: 'later',
    channel: 'session',
    content: 'Me gustaría una sesión esta semana.',
    created_at: iso(Date.now() - 5000),
  };
  const pushOnce = (items) =>
    api('vega', 'post', '/sync/push', { device_id: DEVICE.vega, sent_at: iso(Date.now()), items });
  const p1 = await pushOnce([syncItem(syncUuid, payload)]);
  assert.equal(p1.status, 200, JSON.stringify(p1.body));
  assert.equal(p1.body.results[0].status, 'accepted', JSON.stringify(p1.body.results[0]));
  assert.ok(p1.body.results[0].result.deliver_at);
  assert.deepEqual(p1.body.results[0].result.suggestions, []);
  const p2 = await pushOnce([syncItem(syncUuid, payload)]);
  assert.equal(p2.body.results[0].status, 'duplicate');
  assert.equal(p2.body.results[0].server_id, p1.body.results[0].server_id);
  const p3 = await pushOnce([syncItem(syncUuid, { ...payload, content: 'Otro texto.' })]);
  assert.equal(p3.body.results[0].status, 'conflict');
  assert.equal(p3.body.results[0].error.code, 'PAYLOAD_MISMATCH');
  const p4 = await pushOnce([syncItem(randomUUID(), { urgency: 'soon' })]);
  assert.equal(p4.body.results[0].status, 'rejected');
  assert.equal(p4.body.results[0].error.code, 'VALIDATION_ERROR');
  assert.ok(p4.body.results[0].error.details.some((d) => d.field === 'payload.urgency'));
});

test('urgencia now: sugerencias para la app y nadie a bordo recibe un aviso', async (t) => {
  if (skip(t)) return;
  const counts = async () =>
    (
      await q(`SELECT (SELECT count(*) FROM escalations)::int AS escalations,
                      (SELECT count(*) FROM escalation_messages)::int AS messages,
                      (SELECT count(*) FROM emergency_sessions)::int AS emergencies,
                      (SELECT count(*) FROM reminders)::int AS reminders`)
    )[0];
  const pulls = {};
  for (const who of ['orion', 'vega']) {
    pulls[who] = (await api(who, 'get', '/sync/pull?limit=200')).body.cursor;
  }
  const before = await counts();
  const res = await api('lyra', 'post', '/wellbeing/support-requests', {
    client_uuid: randomUUID(),
    urgency: 'now',
    channel: 'message',
    content: 'Necesito hablar con alguien ahora.',
    created_at: iso(Date.now() - 1000),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(
    res.body.suggestions.map((s) => s.code),
    ['guided_breathing', 'talk_to_cmo'],
  );
  assert.deepEqual(await counts(), before, 'no se crea ningún aviso');
  for (const who of ['orion', 'vega']) {
    const p = await api(who, 'get', `/sync/pull?limit=200&cursor=${pulls[who]}`);
    assert.deepEqual(p.body.escalations, [], who);
    assert.deepEqual(p.body.messages, [], who);
  }
  await arriveRequest(res.body.id);
  const inbox = await api('bh', 'get', '/admin/behavioral/inbox');
  assert.equal(inbox.body.items[0].id, res.body.id, '"ahora" va primero en la bandeja');
  assert.equal(inbox.body.items[0].urgency, 'now');
});

// ---------------------------------------------------------------- PVT, flight surgeon y aptitud

test('flight surgeon: solo la alerta que el catálogo le escala (PVT_LAPSES crítico), sin métricas; aptitud con PVT reciente', async (t) => {
  if (skip(t)) return;
  const pvt = (k, metrics, extra = {}) =>
    api('lyra', 'post', '/wellbeing/pvt-runs', {
      client_uuid: randomUUID(),
      device_id: 'TAB-LYRA',
      measured_at: k === 0 ? iso(Date.now() - 1000) : daysAgo(k),
      before_critical_task: false,
      duration_s: 180,
      trials: 52,
      ...metrics,
      ...extra,
    });
  const base = [
    { lapses: 2, mean_rt_ms: 250, false_starts: 0 },
    { lapses: 3, mean_rt_ms: 260, false_starts: 1 },
    { lapses: 2, mean_rt_ms: 255, false_starts: 0 },
  ];
  for (let i = 0; i < base.length; i += 1) {
    const res = await pvt(3 - i, base[i]);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.fitness, 'not_confirmed', 'sin línea base del dispositivo');
  }
  const fit = await pvt(0, { lapses: 3, mean_rt_ms: 256, false_starts: 0 });
  assert.equal(fit.body.fitness, 'fit', JSON.stringify(fit.body));
  assert.deepEqual(Object.keys(fit.body).sort(), [
    'client_uuid',
    'fitness',
    'id',
    'message',
    'received_at',
  ]);
  const dash = await api('reyes', 'get', '/admin/dashboard/crew');
  assert.equal(dash.body.astronauts.find((a) => a.call_sign === 'LYRA').fitness, 'fit');

  // Antes de una tarea crítica, 25 lapsos (≥ 20 = critical): aptitud no confirmada y alerta
  // de estado al flight surgeon; el detalle, solo a behavioral_health.
  const bad = await pvt(
    0,
    { lapses: 25, mean_rt_ms: 410, false_starts: 2 },
    {
      before_critical_task: true,
    },
  );
  assert.equal(bad.body.fitness, 'not_confirmed');
  await arriveEscalations(A.lyra);
  const fsInbox = await api('reyes', 'get', '/admin/inbox?category=wellbeing');
  assert.equal(fsInbox.status, 200);
  assert.equal(fsInbox.body.items.length, 1, JSON.stringify(fsInbox.body));
  const alert = fsInbox.body.items[0];
  assert.equal(alert.call_sign, 'LYRA');
  assert.ok(/Aptitud no confirmada/.test(alert.reason));
  assert.ok(!/\d|PVT_|lapsos/i.test(alert.reason), 'sin métricas ni indicador');
  assert.equal(alert.evaluation, undefined);
  const adminInbox = await api('admin', 'get', '/admin/inbox?limit=200');
  assert.ok(
    adminInbox.body.items.every((i) => i.id !== alert.id),
    'admin no la ve',
  );
  const bhInbox = await api('bh', 'get', '/admin/behavioral/inbox?limit=200');
  const detail = bhInbox.body.items.find((i) => i.indicator_code === 'PVT_LAPSES');
  assert.ok(detail, 'behavioral_health recibe el detalle');
  assert.equal(detail.kind, 'wellbeing_alert');
  const after = await api('reyes', 'get', '/admin/dashboard/crew');
  assert.equal(after.body.astronauts.find((a) => a.call_sign === 'LYRA').fitness, 'not_confirmed');

  // Sin PVT reciente (más de WELLBEING_FITNESS_MAX_AGE_H = 12 h): no confirmada.
  await q(
    `INSERT INTO pvt_runs (client_uuid, astronaut_id, device_id, fitness, measured_at)
     VALUES ($1, $2, 'tab-test', 'fit', now() - interval '13 hours')`,
    [randomUUID(), A.orion],
  );
  const old = await api('admin', 'get', '/admin/dashboard/crew');
  assert.equal(old.body.astronauts.find((a) => a.call_sign === 'ORION').fitness, 'not_confirmed');
  await q(
    `INSERT INTO pvt_runs (client_uuid, astronaut_id, device_id, fitness, measured_at)
     VALUES ($1, $2, 'tab-test', 'fit', now() - interval '1 hour')`,
    [randomUUID(), A.orion],
  );
  const recent = await api('admin', 'get', '/admin/dashboard/crew');
  assert.equal(recent.body.astronauts.find((a) => a.call_sign === 'ORION').fitness, 'fit');
});

// ---------------------------------------------------------------- PHQ-2 / GAD-2 (extra)

test('PHQ-2 y GAD-2: corte en 3 → escalamiento confidencial; nunca el puntaje al astronauta', async (t) => {
  if (skip(t)) return;
  const screening = (instrument, item1, item2) =>
    api('orion', 'post', '/wellbeing/screenings', {
      client_uuid: randomUUID(),
      instrument,
      measured_at: iso(Date.now() - 1000),
      item_1: item1,
      item_2: item2,
    });
  const before = (await behavioralEscalations(A.orion)).length;
  const low = await screening('PHQ2', 1, 1); // 2: debajo del corte
  assert.equal(low.status, 201, JSON.stringify(low.body));
  assert.equal(low.body.message, recommendation('PHQ2_SCORE', 'normal', 'self_care'));
  assert.equal((await behavioralEscalations(A.orion)).length, before);
  const phq = await screening('PHQ2', 2, 1); // 3: en el corte
  assert.equal(phq.body.message, recommendation('PHQ2_SCORE', 'caution', 'behavioral_health'));
  const gad = await screening('GAD2', 2, 2); // 4
  for (const res of [low, phq, gad]) {
    assert.deepEqual(Object.keys(res.body).sort(), [
      'client_uuid',
      'id',
      'message',
      'offer_support',
      'received_at',
    ]);
    assert.ok(!/\d/.test(res.body.message), 'sin puntaje');
  }
  const rows = (await behavioralEscalations(A.orion)).slice(before);
  assert.deepEqual(
    rows.map((r) => [r.indicator_code, r.level, r.is_confidential]),
    [
      ['PHQ2_SCORE', 'behavioral_health', true],
      ['GAD2_SCORE', 'behavioral_health', true],
    ],
  );
  await arriveEscalations(A.orion);
  const inbox = await api('bh', 'get', '/admin/behavioral/inbox?limit=200');
  const kinds = inbox.body.items.filter((i) => i.astronaut_id === A.orion).map((i) => i.kind);
  assert.deepEqual(kinds, ['screening_alert', 'screening_alert']);
  const detail = await api('bh', 'get', `/admin/behavioral/astronauts/${A.orion}`);
  assert.deepEqual(
    detail.body.screenings.map((s) => [s.instrument, s.score, s.level]),
    [
      ['GAD2', 4, 'caution'],
      ['PHQ2', 3, 'caution'],
      ['PHQ2', 2, 'normal'],
    ],
  );
  // Ya hizo los dos: el próximo check-in no los pide.
  const next = await checkin('orion', 0, sliders(64, 30));
  assert.equal(next.body.screening_due, false);
  // El historial propio dice qué cuestionario hizo, nunca el puntaje.
  const mine = await api('orion', 'get', '/me/wellbeing?limit=50');
  const own = mine.body.items.filter((i) => i.kind === 'screening');
  assert.equal(own.length, 3);
  assert.ok(own.every((i) => i.instrument && !('score' in i)));
});

test('instrumentos: texto oficial en es y en, con licencia y fuentes', async (t) => {
  if (skip(t)) return;
  const es = await api('orion', 'get', '/wellbeing/instruments');
  assert.equal(es.status, 200);
  assert.deepEqual(
    es.body.items.map((i) => [i.code, i.lang, i.official]),
    [
      ['GAD2', 'es', true],
      ['PHQ2', 'es', true],
    ],
  );
  assert.ok(es.body.items.every((i) => i.items.length === 2 && i.options.length === 4));
  assert.ok(es.body.items.every((i) => i.license.includes('Pfizer') && i.sources.length >= 3));
  const en = await api('bh', 'get', '/wellbeing/instruments?lang=en');
  assert.equal(en.status, 200);
  assert.equal(
    en.body.items.find((i) => i.code === 'PHQ2').items[0].text,
    'Little interest or pleasure in doing things',
  );
  assert.equal((await api('orion', 'get', '/wellbeing/instruments?lang=fr')).status, 400);
  assert.equal((await api('reyes', 'get', '/wellbeing/instruments')).status, 403);
});

// ---------------------------------------------------------------- quién ve qué

test('admin, comandante, oficial médico y flight surgeon no ven valores, nota ni solicitudes', async (t) => {
  if (skip(t)) return;
  const lyraRequest = await api('lyra', 'post', '/wellbeing/support-requests', {
    client_uuid: randomUUID(),
    urgency: 'later',
    channel: 'session',
    content: 'Quisiera una sesión.',
    created_at: iso(Date.now() - 1000),
  });
  assert.equal(lyraRequest.status, 201);
  for (const who of ['admin', 'reyes', 'orion', 'vega']) {
    for (const [method, url] of [
      ['get', '/admin/behavioral/inbox'],
      ['get', `/admin/behavioral/astronauts/${A.lyra}`],
      ['post', `/admin/behavioral/support-requests/${lyraRequest.body.id}/messages`],
      ['post', `/admin/behavioral/escalations/${randomUUID()}/ack`],
    ]) {
      const res = await api(who, method, url, method === 'post' ? { body: 'x' } : undefined);
      assert.equal(res.status, 403, `${who} ${method} ${url}`);
    }
  }
  // Las solicitudes de LYRA no las ve otro tripulante (ni comandante ni CMO): ni siquiera existen.
  for (const who of ['orion', 'vega']) {
    const res = await api(
      who,
      'get',
      `/wellbeing/support-requests/${lyraRequest.body.id}/messages`,
    );
    assert.equal(res.status, 404, who);
  }
  for (const who of ['admin', 'reyes', 'bh']) {
    assert.equal((await api(who, 'get', '/me/wellbeing')).status, 403, who);
    assert.equal((await api(who, 'post', '/wellbeing/checkins', {})).status, 403, who);
    assert.equal((await api(who, 'post', '/wellbeing/support-requests', {})).status, 403, who);
  }
  for (const who of ['reyes', 'bh', 'orion']) {
    assert.equal((await api(who, 'get', '/admin/compliance')).status, 403, who);
  }
  // Su propio historial no trae nada de LYRA.
  const orion = await api('orion', 'get', '/me/wellbeing?limit=200');
  const lyraIds = new Set(
    (await q('SELECT id FROM wellbeing_checkins WHERE astronaut_id = $1', [A.lyra])).map(
      (r) => r.id,
    ),
  );
  assert.ok(orion.body.items.every((i) => !lyraIds.has(i.id)));
  assert.ok(!JSON.stringify(orion.body).includes(NOTE));

  // Panel y bandeja: nada conductual (ni valores ni la nota ni solicitudes); admin, ni las
  // alertas de estado de bienestar.
  const confidentialIds = (await q('SELECT id FROM escalations WHERE is_confidential')).map(
    (r) => r.id,
  );
  const requestIds = (await q('SELECT id FROM support_requests')).map((r) => r.id);
  for (const who of ['admin', 'reyes']) {
    for (const url of ['/admin/dashboard/crew', '/admin/inbox?limit=200']) {
      const res = await api(who, 'get', url);
      assert.equal(res.status, 200, `${who} ${url}`);
      const text = JSON.stringify(res.body);
      assert.ok(!CONFIDENTIAL.test(text), `${who} ${url}`);
      assert.ok(!/mood|fatigue|crew_conflict|private_note|urgency/.test(text), `${who} ${url}`);
      assert.ok(!text.includes(NOTE));
      for (const id of [...confidentialIds, ...requestIds]) assert.ok(!text.includes(id));
    }
  }
  const adminInbox = await api('admin', 'get', '/admin/inbox?limit=200');
  assert.ok(adminInbox.body.items.every((i) => i.category !== 'wellbeing'));
  // A bordo, por sync: nada de bienestar de otros (ni escalamientos conductuales propios).
  for (const who of ['orion', 'vega']) {
    const res = await api(who, 'get', '/sync/pull?limit=200');
    assert.ok(
      res.body.escalations.every((e) => e.source_type !== 'wellbeing'),
      who,
    );
    assert.ok(!res.body.evaluations.some((e) => CONFIDENTIAL.test(e.indicator_code)), who);
    assert.ok(!JSON.stringify(res.body).includes(NOTE));
  }
});

test('cumplimiento para admin: check-in hoy, último check-in, racha y aptitud; sin valores ni solicitudes', async (t) => {
  if (skip(t)) return;
  const res = await api('admin', 'get', '/admin/compliance');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.mission_id, ARES1);
  assert.equal(res.body.astronauts.length, 4);
  const allowed = new Set([
    'astronaut_id',
    'call_sign',
    'checkin_today',
    'checkins_completed',
    'checkins_expected',
    'streak_days',
    'last_checkin_at',
    'screenings_completed',
    'pvt_runs',
    'fitness',
  ]);
  for (const a of res.body.astronauts) {
    assert.deepEqual(
      Object.keys(a).filter((k) => !allowed.has(k)),
      [],
      a.call_sign,
    );
    assert.ok(['fit', 'not_confirmed'].includes(a.fitness));
  }
  const lyra = res.body.astronauts.find((a) => a.call_sign === 'LYRA');
  assert.equal(lyra.checkin_today, true);
  assert.equal(lyra.streak_days, 16);
  assert.equal(lyra.checkins_expected, 7);
  assert.equal(lyra.checkins_completed, 7);
  assert.ok(lyra.last_checkin_at);
  assert.equal(lyra.fitness, 'not_confirmed', 'su última PVT no confirma la aptitud');
  assert.ok(lyra.pvt_runs >= 2);
  const orion = res.body.astronauts.find((a) => a.call_sign === 'ORION');
  assert.equal(orion.fitness, 'fit');
  assert.equal(orion.screenings_completed, 3);
  const atlas = res.body.astronauts.find((a) => a.call_sign === 'ATLAS');
  assert.equal(atlas.checkin_today, false);
  assert.equal(atlas.streak_days, 0);
  assert.equal(atlas.last_checkin_at, null);
  const text = JSON.stringify(res.body);
  assert.ok(!CONFIDENTIAL.test(text));
  assert.ok(!/mood|stress|note|support|urgency|level|score/.test(text));
  assert.equal((await api('admin', 'get', '/admin/compliance?from=nope')).status, 400);
  const range = await api(
    'admin',
    'get',
    `/admin/compliance?from=${iso(Date.now() - 3 * DAY)}&to=${iso(Date.now())}`,
  );
  assert.equal(range.status, 200);
  assert.ok(range.body.astronauts.every((a) => a.checkins_expected <= 4));
});

// ---------------------------------------------------------------- bitácora y acuse

test('bitácora: cada lectura de behavioral_health queda registrada (sin el contenido)', async (t) => {
  if (skip(t)) return;
  const before = (await accessLog()).length;
  const inbox = await api('bh', 'get', '/admin/behavioral/inbox?limit=200');
  assert.equal(inbox.status, 200);
  const astronauts = new Set(inbox.body.items.map((i) => i.astronaut_id));
  assert.ok(astronauts.size >= 2);
  const afterInbox = (await accessLog()).slice(before);
  assert.equal(afterInbox.length, astronauts.size, 'una fila por astronauta de la bandeja');
  assert.ok(afterInbox.every((r) => r.resource === 'GET /api/v1/admin/behavioral/inbox'));
  assert.ok(afterInbox.every((r) => r.actor_role === 'behavioral_health' && r.action === 'read'));
  assert.deepEqual(new Set(afterInbox.map((r) => r.astronaut_id)), astronauts);

  const detail = await api('bh', 'get', `/admin/behavioral/astronauts/${A.vega}`);
  assert.equal(detail.status, 200);
  const afterDetail = (await accessLog()).slice(before + afterInbox.length);
  assert.equal(afterDetail.length, 1);
  assert.equal(afterDetail[0].astronaut_id, A.vega);
  assert.equal(afterDetail[0].resource, 'GET /api/v1/admin/behavioral/astronauts/{id}');
  assert.equal(detail.body.support_requests.length, 1, 'solo lo que ya llegó a Tierra');
  assert.equal(detail.body.support_requests[0].id, vegaRequest.id);

  // Acuse y cierre (escrituras): idempotentes; no agregan lecturas a la bitácora.
  const count = (await accessLog()).length;
  const ack = await api('bh', 'post', `/admin/behavioral/support-requests/${vegaRequest.id}/ack`);
  assert.equal(ack.status, 200, JSON.stringify(ack.body));
  assert.equal(ack.body.status, 'acknowledged');
  const close1 = await api(
    'bh',
    'post',
    `/admin/behavioral/support-requests/${vegaRequest.id}/close`,
  );
  const close2 = await api(
    'bh',
    'post',
    `/admin/behavioral/support-requests/${vegaRequest.id}/close`,
  );
  assert.equal(close1.body.status, 'closed');
  assert.equal(close2.body.closed_at, close1.body.closed_at);
  const late = await api(
    'bh',
    'post',
    `/admin/behavioral/support-requests/${vegaRequest.id}/messages`,
    {
      body: 'x',
    },
  );
  assert.equal(late.status, 409, 'cerrada');
  assert.equal((await accessLog()).length, count);
  const open = await api('bh', 'get', '/admin/behavioral/inbox?limit=200');
  assert.ok(
    open.body.items.every((i) => i.id !== vegaRequest.id),
    'lo cerrado sale de la bandeja',
  );
  const all = await api('bh', 'get', '/admin/behavioral/inbox?limit=200&include_closed=true');
  assert.ok(all.body.items.some((i) => i.id === vegaRequest.id));
  // Acuse de un escalamiento conductual.
  const esc = open.body.items.find((i) => i.kind === 'wellbeing_alert' && i.status === 'delivered');
  const escAck = await api('bh', 'post', `/admin/behavioral/escalations/${esc.id}/ack`);
  assert.equal(escAck.status, 200, JSON.stringify(escAck.body));
  assert.equal(escAck.body.status, 'acknowledged');
});

test('ejemplos de docs/examples: el check-in y la solicitud de apoyo entran tal cual', async (t) => {
  if (skip(t)) return;
  const example = (name) => require(`../docs/examples/${name}`);
  const ack = await api('vega', 'post', '/wellbeing/checkins', example('wellbeing-checkin.json'));
  assert.equal(ack.status, 201, JSON.stringify(ack.body));
  assert.equal(ack.body.offer_support, true);
  const again = await api('vega', 'post', '/wellbeing/checkins', example('wellbeing-checkin.json'));
  assert.equal(again.status, 200);
  const req = await api(
    'vega',
    'post',
    '/wellbeing/support-requests',
    example('support-request.json'),
  );
  assert.equal(req.status, 201, JSON.stringify(req.body));
  assert.equal(req.body.urgency, 'now');
  assert.equal(req.body.suggestions.length, 2);
});
