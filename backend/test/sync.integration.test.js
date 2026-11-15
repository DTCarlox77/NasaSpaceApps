'use strict';
// Sincronización offline (tarea 8) contra la base de PRUEBAS: POST /sync/push idempotente con
// resultados por item, orden de proceso, conflictos, reloj, llegada tarde con su
// escalamiento, GET /sync/pull con cursor y retraso de comunicación, confidencialidad del
// bienestar y el lote offline del simulador.
const { openTestDb, resetDatabase } = require('./helpers/db'); // antes que cualquier src/
process.env.RATE_LIMIT_LOGIN_PER_MINUTE = '1000';
process.env.SIMULATOR_ENABLED = 'true';
process.env.SYNC_PULL_SETTLE_MS = '0'; // sin margen: las pruebas leen lo que acaban de escribir
process.env.SYNC_MAX_BATCH = '20';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const ARES1 = '20000000-0000-4000-8000-000000000001';
const A = {
  orion: '10000000-0000-4000-8000-000000000011',
  vega: '10000000-0000-4000-8000-000000000012',
};
const DEVICE = { orion: 'tab-orion', vega: 'tab-vega' };
const CONFIDENTIAL = /WB_|PVT_|PHQ2|GAD2/;

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
    vega: 'k.mensah',
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
const iso = (ms) => new Date(ms).toISOString();
const ago = (minutes) => Date.now() - minutes * 60 * 1000;

/** Lote de ORION desde su tableta (mismo client_uuid en cada reintento: se pasa el body). */
const batch = (items, extra = {}) => ({
  device_id: DEVICE.orion,
  sent_at: iso(Date.now()),
  items,
  ...extra,
});
const push = (body, who = 'orion') => api(who, 'post', '/sync/push', body);
const pull = (query = '', who = 'orion') => api(who, 'get', `/sync/pull${query}`);

function reading(code, values, minutesAgo, { method = 'manual', ...extra } = {}) {
  return {
    client_uuid: randomUUID(),
    entity: 'reading',
    priority: extra.priority || 'normal',
    created_at: iso(ago(minutesAgo) + 5000),
    payload: {
      indicator_code: code,
      measured_at: iso(ago(minutesAgo)),
      values,
      input_method: method,
      ...(extra.supersedes_uuid ? { supersedes_uuid: extra.supersedes_uuid } : {}),
    },
  };
}
const hr = (value, minutesAgo, extra) =>
  reading('HEART_RATE', { value, at_rest: true }, minutesAgo, { method: 'wearable', ...extra });
const spo2 = (value, minutesAgo, extra) =>
  reading('SPO2', { value }, minutesAgo, { method: 'wearable', ...extra });
const bp = (systolic, diastolic, minutesAgo, extra) =>
  reading('BLOOD_PRESSURE', { systolic, diastolic }, minutesAgo, extra);

function wellbeing(entity, payload, minutesAgo) {
  return {
    client_uuid: randomUUID(),
    entity,
    priority: 'normal',
    created_at: iso(ago(minutesAgo)),
    payload: { measured_at: iso(ago(minutesAgo)), ...payload },
  };
}
const checkin = (minutesAgo, sliders = {}) =>
  wellbeing(
    'wellbeing_checkin',
    { mood: 65, fatigue: 30, stress: 30, crew_conflict: 10, sleep_hours: 7.2, ...sliders },
    minutesAgo,
  );
const pvt = (minutesAgo, metrics = {}) =>
  wellbeing(
    'pvt_run',
    {
      device_id: 'TAB-1',
      before_critical_task: false,
      duration_s: 180,
      trials: 52,
      lapses: 2,
      mean_rt_ms: 265,
      false_starts: 1,
      ...metrics,
    },
    minutesAgo,
  );
const screening = (minutesAgo, items = {}) =>
  wellbeing(
    'wellbeing_screening',
    { instrument: 'PHQ2', item_1: 0, item_2: 1, ...items },
    minutesAgo,
  );

const dataCounts = async () =>
  (
    await q(`SELECT (SELECT count(*) FROM readings)::int AS readings,
                    (SELECT count(*) FROM reading_evaluations)::int AS evaluations,
                    (SELECT count(*) FROM escalations)::int AS escalations,
                    (SELECT count(*) FROM wellbeing_checkins)::int AS checkins,
                    (SELECT count(*) FROM pvt_runs)::int AS pvt_runs,
                    (SELECT count(*) FROM instrument_administrations)::int AS instruments`)
  )[0];

/** Pull completo desde `cursor`: junta las páginas hasta has_more = false. */
async function drain(cursor, limit = 200) {
  const pages = [];
  let next = cursor;
  for (let i = 0; i < 100; i += 1) {
    const res = await pull(`?limit=${limit}${next ? `&cursor=${next}` : ''}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    pages.push(res.body);
    next = res.body.cursor;
    if (!res.body.has_more) break;
  }
  return { pages, cursor: next };
}

// ---------------------------------------------------------------- push

test('push: un item malo no tumba el lote (resultado por item)', async (t) => {
  if (skip(t)) return;
  const good = hr(70, 30);
  const temp = reading('BODY_TEMP', { value: 36.7 }, 25);
  const body = batch([
    good,
    spo2(150, 20), // fuera de rango plausible
    { ...hr(71, 10), client_uuid: 'no-es-uuid' },
    { client_uuid: randomUUID(), entity: 'triage_x', created_at: iso(ago(5)), payload: {} },
    {
      client_uuid: randomUUID(),
      entity: 'support_request', // del contrato, todavía sin servicio (tarea 10)
      created_at: iso(ago(5)),
      payload: {},
    },
    reading('WB_MOOD', { value: 50 }, 15, { method: 'slider' }), // bienestar no entra como reading
    temp,
  ]);
  const res = await push(body);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const statuses = res.body.results.map((r) => [r.status, r.error ? r.error.code : null]);
  assert.deepEqual(statuses, [
    ['accepted', null],
    ['rejected', 'VALIDATION_ERROR'],
    ['rejected', 'VALIDATION_ERROR'],
    ['rejected', 'UNKNOWN_ENTITY'],
    ['rejected', 'ENTITY_NOT_SUPPORTED'],
    ['rejected', 'VALIDATION_ERROR'],
    ['accepted', null],
  ]);
  assert.deepEqual(res.body.counts, { accepted: 2, duplicate: 0, conflict: 0, rejected: 5 });
  assert.equal(res.body.results[0].result.evaluation.code, 'HEART_RATE');
  assert.equal(res.body.results[2].client_uuid, null);
  const [row] = await q('SELECT id FROM readings WHERE client_uuid = $1', [temp.client_uuid]);
  assert.equal(row.id, res.body.results[6].server_id);

  // Historial: conteos, offset y duración; sin payload (solo su hash).
  const [b] = await q('SELECT * FROM sync_batches WHERE id = $1', [res.body.batch_id]);
  assert.equal(b.item_count, 7);
  assert.equal(b.accepted_count, 2);
  assert.equal(b.rejected_count, 5);
  assert.equal(b.device_id, DEVICE.orion);
  assert.ok(b.duration_ms >= 0 && b.clock_offset_ms !== null);
  const items = await q('SELECT * FROM sync_items WHERE batch_id = $1 ORDER BY id', [b.id]);
  assert.equal(items.length, 6, 'el item sin client_uuid válido no se registra');
  assert.ok(items.every((i) => /^[0-9a-f]{64}$/.test(i.payload_hash)));
  assert.equal('payload' in items[0], false);
  assert.ok(items.some((i) => i.entity === 'triage_x' && i.error_code === 'UNKNOWN_ENTITY'));
});

test('push: reintentar el lote completo da todo duplicate y ninguna fila de datos nueva', async (t) => {
  if (skip(t)) return;
  const body = batch([
    hr(68, 120),
    bp(118, 76, 110),
    spo2(97, 100),
    checkin(90),
    pvt(80),
    screening(70),
  ]);
  const first = await push(body);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.counts, { accepted: 6, duplicate: 0, conflict: 0, rejected: 0 });
  const before = await dataCounts();

  const retry = await push(body);
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body.counts, { accepted: 0, duplicate: 6, conflict: 0, rejected: 0 });
  // Mismos server_id que la primera vez.
  assert.deepEqual(
    retry.body.results.map((r) => r.server_id),
    first.body.results.map((r) => r.server_id),
  );
  assert.deepEqual(await dataCounts(), before);
  const [b] = await q('SELECT duplicate_count FROM sync_batches WHERE id = $1', [
    retry.body.batch_id,
  ]);
  assert.equal(b.duplicate_count, 6, 'el reintento queda en el historial');
});

test('push: conflict por payload distinto y por segunda corrección (append-only)', async (t) => {
  if (skip(t)) return;
  const original = bp(120, 80, 60);
  const ok = await push(batch([original]));
  const serverId = ok.body.results[0].server_id;
  assert.equal(ok.body.results[0].status, 'accepted');

  // Mismo client_uuid con otro payload.
  const changed = {
    ...original,
    payload: { ...original.payload, values: { systolic: 121, diastolic: 80 } },
  };
  const res = await push(batch([changed]));
  assert.equal(res.body.results[0].status, 'conflict');
  assert.equal(res.body.results[0].error.code, 'PAYLOAD_MISMATCH');
  assert.equal(res.body.results[0].server_id, serverId);

  // Creada en línea (POST /readings) y reenviada por sync: igual → duplicate; distinta → conflict.
  const online = hr(72, 50);
  const created = await api('orion', 'post', '/readings', {
    client_uuid: online.client_uuid,
    ...online.payload,
  });
  assert.equal(created.status, 201);
  const same = await push(batch([online]));
  assert.equal(same.body.results[0].status, 'duplicate');
  assert.equal(same.body.results[0].server_id, created.body.reading.id);
  const other = await push(
    batch([{ ...online, payload: { ...online.payload, values: { value: 99, at_rest: true } } }]),
  );
  assert.equal(other.body.results[0].error.code, 'PAYLOAD_MISMATCH');

  // Segunda corrección del mismo original.
  const fix1 = bp(119, 79, 59, { supersedes_uuid: original.client_uuid });
  const fix2 = bp(118, 78, 58, { supersedes_uuid: original.client_uuid });
  const fixes = await push(batch([fix1, fix2]));
  assert.deepEqual(
    fixes.body.results.map((r) => [r.status, r.error ? r.error.code : null]),
    [
      ['accepted', null],
      ['conflict', 'SUPERSEDE_CONFLICT'],
    ],
  );
  // La original no se tocó.
  const [row] = await q('SELECT components FROM readings WHERE id = $1', [serverId]);
  assert.deepEqual(row.components, { systolic: 120, diastolic: 80 });

  // Bienestar: mismo check-in con otro valor → conflict.
  const ci = checkin(40);
  assert.equal((await push(batch([ci]))).body.results[0].status, 'accepted');
  const ciChanged = { ...ci, payload: { ...ci.payload, mood: 10 } };
  assert.equal((await push(batch([ciChanged]))).body.results[0].error.code, 'PAYLOAD_MISMATCH');
});

test('push: orden de proceso — emergency, luego críticos y luego el resto por measured_at', async (t) => {
  if (skip(t)) return;
  const a = hr(66, 180); // normal, el más viejo
  const b = reading('BODY_TEMP', { value: 36.5 }, 120);
  const c = spo2(89, 60); // crítico por su valor
  const d = hr(70, 30, { priority: 'emergency' });
  const e = bp(118, 76, 240); // original normal…
  const f = bp(190, 125, 235, { supersedes_uuid: e.client_uuid }); // …corregida a crítica
  const res = await push(batch([a, b, c, d, f, e]));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const seq = Object.fromEntries(
    res.body.results.map((r, i) => [['a', 'b', 'c', 'd', 'f', 'e'][i], r.sequence]),
  );
  assert.deepEqual(seq, { d: 1, e: 2, f: 3, c: 4, a: 5, b: 6 });
  assert.ok(
    res.body.results.every((r) => r.status === 'accepted'),
    JSON.stringify(res.body),
  );
  // sync_items queda en el orden de proceso.
  const items = await q('SELECT client_uuid FROM sync_items WHERE batch_id = $1 ORDER BY id', [
    res.body.batch_id,
  ]);
  assert.deepEqual(
    items.map((i) => i.client_uuid),
    [d, e, f, c, a, b].map((x) => x.client_uuid),
  );
});

test('push: reloj — futuro rejected, offset guardado y measured_at sin corregir', async (t) => {
  if (skip(t)) return;
  const future = hr(70, -10); // 10 min en el futuro
  const nearFuture = hr(71, -4); // dentro de la tolerancia (5 min)
  const res = await push(batch([future, nearFuture], { sent_at: iso(Date.now() - 3600 * 1000) }));
  assert.equal(res.body.results[0].status, 'rejected');
  assert.equal(res.body.results[0].error.code, 'FUTURE_TIMESTAMP');
  assert.equal(res.body.results[1].status, 'accepted');
  assert.ok(Math.abs(res.body.clock_offset_s - 3600) <= 5, String(res.body.clock_offset_s));
  const [b] = await q('SELECT clock_offset_ms FROM sync_batches WHERE id = $1', [
    res.body.batch_id,
  ]);
  assert.ok(Math.abs(Number(b.clock_offset_ms) - 3600 * 1000) < 5000);
  const [r] = await q('SELECT measured_at FROM readings WHERE id = $1', [
    res.body.results[1].server_id,
  ]);
  assert.equal(r.measured_at.toISOString(), nearFuture.payload.measured_at);
});

test('push: dispositivo ajeno → 403; lote > SYNC_MAX_BATCH → 413; solo astronautas', async (t) => {
  if (skip(t)) return;
  const before = (await q('SELECT count(*)::int AS n FROM sync_batches'))[0].n;
  // VEGA inició sesión en tab-vega: para ORION es ajeno.
  for (const device of [DEVICE.vega, 'tableta-desconocida']) {
    const res = await push(batch([hr(70, 5)], { device_id: device }));
    assert.equal(res.status, 403, device);
    assert.equal(res.body.error.code, 'DEVICE_NOT_OWNED');
  }
  // Una tableta registrada de su misión sí.
  assert.equal((await push(batch([hr(70, 4)], { device_id: 'TAB-1' }))).status, 200);

  const big = batch(Array.from({ length: 21 }, (_, i) => hr(70, 30 + i)));
  const tooLarge = await push(big);
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(tooLarge.body.error.details.max_items, 20);

  assert.equal((await push(batch([hr(70, 3)]), 'reyes')).status, 403);
  assert.equal((await push({ device_id: DEVICE.orion, items: [hr(70, 3)] })).status, 400);
  const after = (await q('SELECT count(*)::int AS n FROM sync_batches'))[0].n;
  assert.equal(after, before + 1, 'solo el lote válido quedó en el historial');
});

test('push: un crítico que llega tarde se evalúa con su measured_at y escala desde la recepción', async (t) => {
  if (skip(t)) return;
  const late = spo2(89, 30 * 60); // medido hace 30 h
  const res = await push(batch([late]));
  const result = res.body.results[0];
  assert.equal(result.status, 'accepted', JSON.stringify(result));
  assert.equal(result.result.evaluation.level, 'critical');
  assert.equal(result.result.late_sync, true);
  assert.ok(Math.abs(result.result.lag_s - 30 * 3600) < 30, String(result.result.lag_s));

  const escalations = await q(
    `SELECT level::text AS level, created_at, deliver_at FROM escalations
     WHERE source_id = $1 ORDER BY level`,
    [result.server_id],
  );
  assert.deepEqual(
    escalations.map((e) => e.level),
    ['crew', 'flight_surgeon'],
    'un crítico viejo sigue escalando',
  );
  const ground = escalations.find((e) => e.level === 'flight_surgeon');
  assert.ok(Date.now() - ground.created_at.getTime() < 60 * 1000, 'desde la recepción');
  assert.equal((ground.deliver_at - ground.created_at) / 1000, 90, 'retraso de ARES-1');

  const [item] = await q('SELECT late_sync, lag_s FROM sync_items WHERE batch_id = $1', [
    res.body.batch_id,
  ]);
  assert.equal(item.late_sync, true);
  assert.ok(item.lag_s >= 30 * 3600 - 30);

  // En la bandeja del flight surgeon (cuando llega) se ve "registrado hace 30 h".
  await q(
    `UPDATE escalations SET created_at = created_at - interval '2 minutes',
                            deliver_at = deliver_at - interval '2 minutes'
     WHERE source_id = $1`,
    [result.server_id],
  );
  const inbox = await api('reyes', 'get', '/admin/inbox?limit=200');
  const entry = inbox.body.items.find((i) => i.source_id === result.server_id);
  assert.ok(entry, 'está en la bandeja');
  assert.equal(entry.late_sync, true);
  assert.ok(entry.lag_s >= 30 * 3600 - 30);
  assert.equal(new Date(entry.measured_at).toISOString(), late.payload.measured_at);
});

test('push: durante un corte el escalamiento a Tierra queda en cola (deliver_at null)', async (t) => {
  if (skip(t)) return;
  const outage = await api('admin', 'post', '/admin/comm-outages', {
    mission_id: ARES1,
    starts_at: iso(ago(1)),
    reason: 'Conjunción solar (prueba sync)',
  });
  assert.equal(outage.status, 201, JSON.stringify(outage.body));
  try {
    const res = await push(batch([spo2(88, 120)]));
    const id = res.body.results[0].server_id;
    const rows = await q(
      `SELECT level::text AS level, deliver_at FROM escalations WHERE source_id = $1 ORDER BY level`,
      [id],
    );
    assert.equal(rows.find((r) => r.level === 'flight_surgeon').deliver_at, null);
    assert.ok(rows.find((r) => r.level === 'crew').deliver_at, 'a bordo llega igual');
    const p = await pull('?limit=1');
    assert.equal(p.body.mission.link.status, 'outage');
  } finally {
    await api('admin', 'patch', `/admin/comm-outages/${outage.body.id}`, {
      ends_at: iso(Date.now()),
    });
  }
});

// ---------------------------------------------------------------- pull

test('pull: cursor estable, paginado y sin repetir', async (t) => {
  if (skip(t)) return;
  // Que nada "llegue" a mitad de la prueba: lo que va en camino a Tierra ya llegó.
  await q(
    `UPDATE escalations SET created_at = created_at - interval '5 minutes',
                            deliver_at = deliver_at - interval '5 minutes'
     WHERE astronaut_id = $1 AND deliver_at > now() - interval '5 minutes'`,
    [A.orion],
  );
  const all = await drain(undefined, 200);
  const expected = (
    await q(
      `SELECT count(*)::int AS n FROM v_readings_standard r
       JOIN reading_evaluations e ON e.reading_id = r.id WHERE r.astronaut_id = $1`,
      [A.orion],
    )
  )[0].n;
  const allEvaluations = all.pages.flatMap((p) => p.evaluations);
  assert.equal(allEvaluations.length, expected);

  // Paginado con limit chico: mismas cosas, en el mismo orden, sin repetir.
  const small = await drain(undefined, 7);
  assert.ok(small.pages.length > 2);
  assert.ok(small.pages.slice(0, -1).every((p) => p.has_more));
  const feed = (pages) =>
    pages.flatMap((p) => [
      ...p.evaluations.map((e) => `e:${e.reading_id}`),
      ...p.escalations.map((e) => `s:${e.id}`),
      ...p.messages.map((m) => `m:${m.id}`),
    ]);
  const smallFeed = feed(small.pages);
  assert.equal(new Set(smallFeed).size, smallFeed.length);
  assert.deepEqual(new Set(smallFeed), new Set(feed(all.pages)));
  for (const page of small.pages) {
    const n = page.evaluations.length + page.escalations.length + page.messages.length;
    assert.ok(n <= 7);
  }

  // Mismo cursor → misma respuesta (salvo server_time).
  const strip = ({ server_time: _, ...rest }) => rest;
  const second = small.pages[0].cursor;
  const once = await pull(`?limit=7&cursor=${second}`);
  const twice = await pull(`?limit=7&cursor=${second}`);
  assert.deepEqual(strip(once.body), strip(twice.body));
  assert.deepEqual(strip(once.body), strip(small.pages[1]));

  // Al final: nada nuevo y nada cambió.
  const end = await pull(`?cursor=${all.cursor}`);
  assert.equal(end.body.has_more, false);
  assert.deepEqual([end.body.evaluations, end.body.escalations, end.body.messages], [[], [], []]);
  assert.equal(end.body.rules.changed, false);
  assert.equal(end.body.catalog.changed, false);
  assert.equal(end.body.mission.changed, false);
  assert.equal(all.pages[0].rules.changed, true, 'sin cursor, todo es nuevo');

  // Algo nuevo aparece desde ese cursor, una sola vez.
  const fresh = hr(69, 1);
  const pushed = await push(batch([fresh]));
  const after = await pull(`?cursor=${all.cursor}`);
  assert.deepEqual(
    after.body.evaluations.map((e) => e.reading_id),
    [pushed.body.results[0].server_id],
  );
  assert.equal(after.body.evaluations[0].client_uuid, fresh.client_uuid);

  assert.equal((await pull('?cursor=nope')).status, 400);
  assert.equal((await pull('?limit=0')).status, 400);
  assert.equal((await pull('', 'reyes')).status, 403);
});

test('pull: la respuesta de Tierra no llega antes de deliver_at ni durante un corte', async (t) => {
  if (skip(t)) return;
  const res = await push(batch([spo2(90, 10)]));
  const readingId = res.body.results[0].server_id;
  const [esc] = await q(
    `SELECT id FROM escalations WHERE source_id = $1 AND level = 'flight_surgeon'`,
    [readingId],
  );
  // Que ya haya llegado a Tierra (sin esperar 90 s).
  await q(
    `UPDATE escalations SET created_at = created_at - interval '2 minutes',
                            deliver_at = deliver_at - interval '2 minutes' WHERE id = $1`,
    [esc.id],
  );
  const { cursor } = await drain();
  const reply = await api('reyes', 'post', `/admin/escalations/${esc.id}/messages`, {
    body: 'Recibido. Repite la SpO₂ en 10 min y avisa al CMO.',
  });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));

  // Todavía en camino (deliver_at = ahora + 90 s): no sale.
  const early = await pull(`?cursor=${cursor}`);
  assert.deepEqual(early.body.messages, []);
  // Ya llegó.
  await q(
    `UPDATE escalation_messages SET created_at = created_at - interval '2 minutes',
                                    deliver_at = deliver_at - interval '2 minutes' WHERE id = $1`,
    [reply.body.id],
  );
  const arrived = await pull(`?cursor=${cursor}`);
  const message = arrived.body.messages.find((m) => m.id === reply.body.id);
  assert.ok(message, JSON.stringify(arrived.body.messages));
  assert.equal(message.channel, 'escalation');
  assert.equal(message.thread_id, esc.id);
  assert.equal(message.author_role, 'flight_surgeon');
  assert.equal(message.direction, 'to_crew');

  // Corte de enlace: la segunda respuesta queda en cola (deliver_at null) y no sale.
  const outage = await api('admin', 'post', '/admin/comm-outages', {
    mission_id: ARES1,
    starts_at: iso(Date.now()), // la del push anterior se cerró hace un momento
    reason: 'Corte de prueba (pull)',
  });
  assert.equal(outage.status, 201, JSON.stringify(outage.body));
  try {
    const queued = await api('reyes', 'post', `/admin/escalations/${esc.id}/messages`, {
      body: 'Segundo mensaje durante el corte.',
    });
    assert.equal(queued.status, 201);
    const [row] = await q('SELECT deliver_at FROM escalation_messages WHERE id = $1', [
      queued.body.id,
    ]);
    assert.equal(row.deliver_at, null);
    const during = await pull(`?cursor=${arrived.body.cursor}`);
    assert.deepEqual(during.body.messages, []);
    assert.equal(during.body.mission.link.status, 'outage');
  } finally {
    await api('admin', 'patch', `/admin/comm-outages/${outage.body.id}`, {
      ends_at: iso(Date.now()),
    });
  }
});

// ---------------------------------------------------------------- bienestar

test('bienestar por sync: neutro para el astronauta e invisible para admin y el dashboard', async (t) => {
  if (skip(t)) return;
  const res = await push(
    batch([
      checkin(20, { mood: 5, fatigue: 95, stress: 95, crew_conflict: 90 }),
      screening(15, { item_1: 3, item_2: 3 }),
      pvt(10, { lapses: 25, mean_rt_ms: 480, false_starts: 6 }),
    ]),
  );
  assert.equal(res.status, 200);
  assert.ok(
    res.body.results.every((r) => r.status === 'accepted'),
    JSON.stringify(res.body),
  );
  for (const r of res.body.results) {
    const text = JSON.stringify(r.result);
    assert.equal(/"level"|"score"|"escalation|WB_|PHQ2_/.test(text), false, text);
    assert.equal(typeof r.result.message, 'string');
  }
  assert.ok(['fit', 'not_confirmed'].includes(res.body.results[2].result.fitness));

  // Las lecturas quedan agrupadas y con client_uuid derivados (no el del item).
  const [group] = await q(
    `SELECT count(*)::int AS n FROM readings r JOIN wellbeing_checkins c ON c.id = r.wellbeing_checkin_id
     WHERE c.client_uuid = $1 AND r.client_uuid <> c.client_uuid`,
    [res.body.results[0].client_uuid],
  );
  assert.equal(group.n, 5, 'cuatro deslizadores + sueño');

  for (const who of ['admin', 'reyes']) {
    const dash = await api(who, 'get', '/admin/dashboard/crew');
    assert.equal(CONFIDENTIAL.test(JSON.stringify(dash.body)), false, `${who}: dashboard`);
    const inbox = await api(who, 'get', '/admin/inbox?limit=200');
    assert.equal(CONFIDENTIAL.test(JSON.stringify(inbox.body)), false, `${who}: bandeja`);
  }
  // Ni el propio astronauta recibe niveles ni escalamientos de bienestar por pull.
  const { pages } = await drain();
  const text = JSON.stringify(pages);
  assert.equal(CONFIDENTIAL.test(text), false);
  assert.ok(pages.every((p) => p.escalations.every((e) => e.source_type !== 'wellbeing')));
  // Pero sí existe el escalamiento confidencial (solo behavioral_health).
  const [bh] = await q(
    `SELECT count(*)::int AS n FROM escalations
     WHERE astronaut_id = $1 AND is_confidential AND level = 'behavioral_health'`,
    [A.orion],
  );
  assert.ok(bh.n > 0);
});

// ---------------------------------------------------------------- simulador

test('simulador: offline_batch empuja ~24 h por sync sin chocar con la historia', async (t) => {
  if (skip(t)) return;
  const history = await api('admin', 'post', '/admin/simulator/history', { days: 3, seed: 7 });
  assert.equal(history.status, 200, JSON.stringify(history.body));
  const res = await api('admin', 'post', '/admin/simulator/scenarios/offline_batch', {
    astronaut: 'VEGA',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  // 13 items: todos nuevos salvo el reintento planeado (ningún client_uuid de la historia).
  assert.deepEqual(res.body.sync.counts, { accepted: 12, duplicate: 1, conflict: 0, rejected: 0 });
  assert.deepEqual(res.body.errors, []);
  assert.equal(res.body.levels.SPO2.critical, 1);
  assert.ok(res.body.escalations.by_level.flight_surgeon > 0);
  assert.ok(res.body.sync.late_sync > 0);
  const again = await api('admin', 'post', '/admin/simulator/scenarios/offline_batch', {
    astronaut: 'VEGA',
  });
  if (again.body.at === res.body.at) {
    assert.deepEqual(again.body.sync.counts, {
      accepted: 0,
      duplicate: 13,
      conflict: 0,
      rejected: 0,
    });
  }

  // El ejemplo del contrato (docs/examples/sync-push.json) es un lote válido.
  const example = require('../docs/examples/sync-push.json');
  const pushed = await push(example);
  assert.equal(pushed.status, 200, JSON.stringify(pushed.body));
  assert.deepEqual(pushed.body.counts, { accepted: 12, duplicate: 1, conflict: 0, rejected: 0 });
  const sequence = new Map(pushed.body.results.map((r, i) => [example.items[i], r.sequence]));
  const critical = example.items.find(
    (i) => i.payload.indicator_code === 'SPO2' && i.payload.values.value === 89,
  );
  assert.equal(sequence.get(critical), 1, 'el crítico se procesa primero');
});
