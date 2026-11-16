'use strict';
// Pantalla "Tripulación" (GET /crew/status) contra la base de PRUEBAS: roster y alertas físicas
// sin valores para toda la tripulación, semáforo físico solo para el CMO, nada de bienestar
// para nadie y 403 para Tierra y service.
const { openTestDb, resetDatabase } = require('./helpers/db'); // antes que cualquier src/
process.env.RATE_LIMIT_LOGIN_PER_MINUTE = '1000';
process.env.SYNC_PULL_SETTLE_MS = '0'; // el pull lee lo que la prueba acaba de escribir

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
const USERS = {
  admin: 'mission.control',
  reyes: 'dr.reyes',
  bh: 'bh.salas',
  svc: 'svc.habitat',
  orion: 'a.ortega',
  vega: 'k.mensah',
  lyra: 'l.tanaka',
};
// Nada de esto puede salir en la respuesta de ningún tripulante. SLEEP_HOURS llega con el
// check-in (diría quién lo hizo y a qué hora); con estos datos tampoco escala a bordo.
const FORBIDDEN_TEXT = /WB_|PVT|PHQ|GAD|SLEEP_HOURS|fitness|support|checkin|"sex"|"note"|"reason"/i;
const ALERT_KEYS = ['created_at', 'escalation_id', 'indicator_code', 'indicator_name', 'level'];

let db = null;
let SKIP_REASON = '';
let request = null;
let app = null;
const tokens = {};
const ids = {}; // lecturas y escalamientos creados en el before

const q = async (sql, params) => (await db.pool.query(sql, params)).rows;
const api = (who, method, url, body) => {
  const r = request(app)[method](`/api/v1${url}`).set('Authorization', `Bearer ${tokens[who]}`);
  return body === undefined ? r : r.send(body);
};
const iso = (ms = Date.now()) => new Date(ms).toISOString();

async function reading(who, code, values, escalation = 'crew', inputMethod = 'manual') {
  const res = await api(who, 'post', '/readings', {
    client_uuid: randomUUID(),
    indicator_code: code,
    measured_at: iso(Date.now() - 1000),
    values,
    input_method: inputMethod,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.evaluation.escalation, escalation, `${code}: ${JSON.stringify(res.body)}`);
  return res.body.reading.id;
}
const crewEscalation = async (readingId) =>
  (await q(`SELECT id FROM escalations WHERE source_id = $1 AND level = 'crew'`, [readingId]))[0]
    .id;

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
      .send({ username, password: 'Demo2026!', device_id: `ipad-${name}` });
    assert.equal(res.status, 200, `login ${name}`);
    tokens[name] = res.body.access_token;
  }

  // Físico: dos alertas a bordo de LYRA, una de ORION y una de ORION de hace más de 24 h.
  ids.lyraHr = await reading('lyra', 'HEART_RATE', { value: 120 });
  ids.lyraTemp = await reading('lyra', 'BODY_TEMP', { value: 38.4 });
  ids.lyraSpo2 = await reading('lyra', 'SPO2', { value: 98 }, 'self_care');
  ids.orionSpo2 = await reading('orion', 'SPO2', { value: 92 });
  ids.orionOld = await reading('orion', 'RESP_RATE', { value: 22 });
  // Cefalea de VEGA (caution, self_care): lo único que puede colorear brain en el semáforo.
  await reading('vega', 'SYMPTOM', { symptoms: ['headache'] }, 'self_care', 'clicks');
  ids.oldAlert = await crewEscalation(ids.orionOld);
  await q(
    `UPDATE escalations SET created_at = now() - interval '25 hours',
                            deliver_at = now() - interval '25 hours' WHERE id = $1`,
    [ids.oldAlert],
  );

  // Bienestar de LYRA y ORION por las rutas reales: check-in, PVT, apoyo y PHQ-2.
  const wellbeing = [
    api('lyra', 'post', '/wellbeing/checkins', {
      client_uuid: randomUUID(),
      measured_at: iso(Date.now() - 1000),
      sleep_hours: 5,
      mood: 10,
      fatigue: 95,
      stress: 95,
      crew_conflict: 90,
    }),
    api('lyra', 'post', '/wellbeing/pvt-runs', {
      client_uuid: randomUUID(),
      device_id: 'TAB-LYRA',
      measured_at: iso(Date.now() - 1000),
      before_critical_task: true,
      duration_s: 180,
      trials: 52,
      lapses: 12,
      mean_rt_ms: 480,
      false_starts: 4,
    }),
    api('lyra', 'post', '/wellbeing/support-requests', {
      client_uuid: randomUUID(),
      urgency: 'now',
      channel: 'message',
      content: 'Necesito hablar con alguien.',
      created_at: iso(Date.now() - 1000),
    }),
    api('orion', 'post', '/wellbeing/screenings', {
      client_uuid: randomUUID(),
      instrument: 'PHQ2',
      measured_at: iso(Date.now() - 1000),
      item_1: 3,
      item_2: 3,
    }),
  ];
  for (const res of await Promise.all(wellbeing)) {
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }

  // Trampa: un escalamiento conductual con level crew (no lo crea el motor). Tampoco debe salir.
  const [wb] = await q(
    `SELECT id FROM readings WHERE astronaut_id = $1 AND indicator_code LIKE 'WB_%' LIMIT 1`,
    [A.lyra],
  );
  const [trap] = await q(
    `INSERT INTO escalations (mission_id, astronaut_id, source_type, source_id, level, priority,
                              status, reason, deliver_at, category, is_confidential)
     VALUES ($1, $2, 'wellbeing', $3, 'crew', 'urgent', 'delivered', 'WB_MOOD en critical: 10.',
             now(), 'behavioral', false)
     RETURNING id`,
    [ARES1, A.lyra, wb.id],
  );
  ids.trap = trap.id;

  // Las negativas no pasan de vacío: el bienestar existe en la base.
  const [seen] = await q(
    `SELECT (SELECT count(*) FROM readings r JOIN indicators i ON i.code = r.indicator_code
             WHERE i.sensitivity = 'confidential' AND r.mission_id = $1)::int AS confidential,
            (SELECT count(*) FROM escalations WHERE category = 'behavioral' AND mission_id = $1)::int
              AS behavioral,
            (SELECT count(*) FROM support_requests)::int AS support,
            (SELECT count(*) FROM pvt_runs)::int AS pvt`,
    [ARES1],
  );
  assert.ok(seen.confidential >= 8, JSON.stringify(seen)); // 4 WB_ + 3 PVT_ + PHQ2
  assert.ok(seen.behavioral >= 2 && seen.support >= 1 && seen.pvt >= 1, JSON.stringify(seen));
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

async function status(who) {
  const res = await api(who, 'get', '/crew/status');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.doesNotMatch(JSON.stringify(res.body), FORBIDDEN_TEXT, `${who}: algo confidencial`);
  return res.body;
}
const member = (body, astronautId) => body.crew.find((m) => m.astronaut_id === astronautId);

test('tripulante normal: roster y alertas físicas sin valores; physical null', async (t) => {
  if (skip(t)) return;
  const body = await status('lyra');
  assert.deepEqual(body.mission, { id: ARES1, code: 'ARES-1' });
  assert.equal(body.viewer_crew_role, 'flight_engineer');
  assert.ok(!Number.isNaN(Date.parse(body.generated_at)));
  assert.deepEqual(
    body.crew.map((m) => [m.call_sign, m.crew_role]),
    [
      ['ATLAS', 'mission_specialist'],
      ['LYRA', 'flight_engineer'],
      ['ORION', 'commander'],
      ['VEGA', 'crew_medical_officer'],
    ],
  );
  for (const m of body.crew) {
    assert.deepEqual(Object.keys(m).sort(), [
      'astronaut_id',
      'call_sign',
      'crew_alerts',
      'crew_role',
      'display_name',
      'emergency',
      'physical',
    ]);
    assert.equal(m.physical, null, `${m.call_sign}: physical`);
    assert.equal(m.emergency, null, 'sin emergencia abierta');
  }
  assert.equal(member(body, A.orion).display_name, 'Ana Ortega (sintética)');

  const lyra = member(body, A.lyra).crew_alerts;
  assert.deepEqual(lyra.map((a) => a.indicator_code).sort(), ['BODY_TEMP', 'HEART_RATE']);
  for (const alert of lyra) {
    assert.deepEqual(Object.keys(alert).sort(), ALERT_KEYS, 'sin valores ni motivo');
    assert.equal(alert.level, 'caution');
  }
  const hr = lyra.find((a) => a.indicator_code === 'HEART_RATE');
  assert.equal(hr.escalation_id, await crewEscalation(ids.lyraHr));
  assert.equal(hr.indicator_name, 'Frecuencia cardíaca en reposo');
  assert.ok(!lyra.some((a) => a.escalation_id === ids.trap), 'el conductual no sale');
  // Más reciente primero.
  assert.ok(Date.parse(lyra[0].created_at) >= Date.parse(lyra[1].created_at));

  const orion = member(body, A.orion).crew_alerts;
  assert.deepEqual(
    orion.map((a) => a.indicator_code),
    ['SPO2'],
    'la de hace más de 24 h no sale',
  );
  assert.deepEqual(member(body, A.atlas).crew_alerts, []);
  assert.deepEqual(member(body, A.vega).crew_alerts, []);
  // Ningún valor numérico de las lecturas (120, 38.4, 92) viaja en la respuesta.
  assert.doesNotMatch(JSON.stringify(body), /"value"|38\.4|"components"|"values"/);
});

test('CMO: semáforo físico de todos (también el propio), sin nada confidencial', async (t) => {
  if (skip(t)) return;
  const body = await status('vega');
  assert.equal(body.viewer_crew_role, 'crew_medical_officer');
  for (const m of body.crew) {
    assert.ok(m.physical, `${m.call_sign}: physical`);
    assert.deepEqual(Object.keys(m.physical).sort(), ['indicators', 'zones']);
    assert.deepEqual(
      m.physical.zones.map((z) => z.zone),
      ['heart', 'lungs', 'immune', 'metabolism', 'muscle', 'bones', 'brain', 'eyes'],
    );
    for (const i of m.physical.indicators) {
      assert.deepEqual(Object.keys(i).sort(), ['code', 'last_value', 'level', 'measured_at']);
      assert.doesNotMatch(i.code, /^(WB_|PVT_|PHQ2|GAD2|HAB_)/);
    }
  }
  const lyra = member(body, A.lyra).physical;
  const zone = (name) => lyra.zones.find((z) => z.zone === name).worst_level;
  assert.equal(zone('heart'), 'caution');
  assert.equal(zone('immune'), 'caution');
  assert.equal(zone('lungs'), 'normal');
  assert.equal(zone('metabolism'), 'unrated');
  assert.deepEqual(
    lyra.indicators.map((i) => i.code),
    ['HEART_RATE', 'SPO2', 'BODY_TEMP'],
    'solo los que tienen lectura, en el orden del catálogo; sin SLEEP_HOURS',
  );
  // LYRA sí tiene un SLEEP_HOURS en caution (llegó con su check-in): no colorea brain.
  const [sleep] = await q(
    `SELECT e.level FROM readings r JOIN reading_evaluations e ON e.reading_id = r.id
     WHERE r.astronaut_id = $1 AND r.indicator_code = 'SLEEP_HOURS'`,
    [A.lyra],
  );
  assert.equal(sleep.level, 'caution', 'la lectura existe y está en caution');
  assert.equal(zone('brain'), 'unrated', 'SLEEP_HOURS no colorea brain');
  const hr = lyra.indicators.find((i) => i.code === 'HEART_RATE');
  assert.equal(hr.level, 'caution');
  assert.deepEqual(hr.last_value, { value: 120 });
  assert.ok(!Number.isNaN(Date.parse(hr.measured_at)));

  const orion = member(body, A.orion).physical;
  assert.deepEqual(orion.indicators.map((i) => i.code).sort(), ['RESP_RATE', 'SPO2']);
  // ORION tiene un PHQ-2 alto (escalado a behavioral_health).
  assert.equal(
    orion.zones.find((z) => z.zone === 'brain').worst_level,
    'unrated',
    'el bienestar no colorea brain',
  );
  // brain solo lo colorea SYMPTOM: la cefalea de VEGA (el CMO se ve a sí mismo).
  const vega = member(body, A.vega).physical;
  assert.deepEqual(
    vega.indicators.map((i) => [i.code, i.level]),
    [['SYMPTOM', 'caution']],
  );
  assert.deepEqual(vega.indicators[0].last_value, { symptoms: ['headache'] });
  assert.equal(vega.zones.find((z) => z.zone === 'brain').worst_level, 'caution');
  const atlas = member(body, A.atlas).physical;
  assert.deepEqual(atlas.indicators, []);
  assert.ok(atlas.zones.every((z) => z.worst_level === 'unrated'));
  // El CMO también ve las alertas de toda la tripulación.
  assert.equal(member(body, A.lyra).crew_alerts.length, 2);
});

test('comandante: roster y alertas, sin semáforo físico', async (t) => {
  if (skip(t)) return;
  const body = await status('orion');
  assert.equal(body.viewer_crew_role, 'commander');
  assert.ok(body.crew.every((m) => m.physical === null));
  assert.equal(member(body, A.lyra).crew_alerts.length, 2);
  assert.equal(member(body, A.orion).crew_alerts.length, 1);
});

test('emergencia abierta: id y estado en cada fila; al cerrarla vuelve a null', async (t) => {
  if (skip(t)) return;
  const opened = await api('orion', 'post', '/emergency/sessions', {
    client_uuid: randomUUID(),
    trigger_type: 'manual_button',
    started_at: iso(),
    responder_safe: { value: true },
  });
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  const sessionId = opened.body.session.id;
  for (const who of ['lyra', 'vega', 'orion']) {
    const body = await status(who);
    for (const m of body.crew) {
      assert.deepEqual(m.emergency, { session_id: sessionId, status: 'active' }, who);
    }
  }
  const closed = await api('orion', 'post', `/emergency/sessions/${sessionId}/close`, {
    closed_at: iso(),
    status: 'cancelled',
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.ok((await status('lyra')).crew.every((m) => m.emergency === null));
});

test('Tierra y service → 403; sin sesión → 401', async (t) => {
  if (skip(t)) return;
  for (const who of ['admin', 'reyes', 'bh', 'svc']) {
    const res = await api(who, 'get', '/crew/status');
    assert.equal(res.status, 403, `${who}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.equal(res.body.crew, undefined);
  }
  const anon = await request(app).get('/api/v1/crew/status');
  assert.equal(anon.status, 401);
});

/** Escalamientos que le llegan al astronauta (GET /sync/pull → escalations), todas las páginas. */
async function ownEscalations(who) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const query = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const res = await api(who, 'get', `/sync/pull?limit=200${query}`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    out.push(...res.body.escalations);
    if (!res.body.has_more) return out;
    cursor = res.body.cursor;
  }
  throw new Error('el pull no terminó');
}

test('3 noches cortas: la alerta de sueño escala a bordo pero no sale en crew_alerts', async (t) => {
  if (skip(t)) return;
  const DAY = 24 * 60 * 60 * 1000;
  // ORION duerme 5 h tres noches seguidas (una por día UTC). La tercera cumple
  // consecutive_nights_le_6h >= 3 → caution, escala a crew.
  const night = (k) =>
    api('orion', 'post', '/readings', {
      client_uuid: randomUUID(),
      indicator_code: 'SLEEP_HOURS',
      measured_at: iso(Date.now() - k * DAY - 1000),
      values: { value: 5 },
      input_method: 'manual',
    });
  for (const k of [2, 1]) {
    const res = await night(k);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.evaluation.escalation, 'self_care', `noche -${k}`);
  }
  const third = await night(0);
  assert.equal(third.status, 201, JSON.stringify(third.body));
  assert.equal(third.body.evaluation.level, 'caution');
  assert.equal(third.body.evaluation.escalation, 'crew', 'regla de 3 noches cortas');

  // El escalamiento no cambia: existe, es físico, a bordo y ya entregado.
  const escalationId = await crewEscalation(third.body.reading.id);
  const [row] = await q(
    `SELECT level::text AS level, category, status::text AS status, is_confidential
     FROM escalations WHERE id = $1`,
    [escalationId],
  );
  assert.deepEqual(row, {
    level: 'crew',
    category: 'physical',
    status: 'delivered',
    is_confidential: false,
  });

  // En la pantalla "Tripulación" no la ve nadie (status() busca además SLEEP_HOURS en el JSON).
  for (const who of ['orion', 'vega', 'lyra']) {
    const body = await status(who);
    for (const m of body.crew) {
      assert.ok(
        m.crew_alerts.every((a) => a.escalation_id !== escalationId),
        `${who} ve la alerta de sueño de ORION`,
      );
    }
    assert.deepEqual(
      member(body, A.orion).crew_alerts.map((a) => a.indicator_code),
      ['SPO2'],
      who,
    );
  }

  // El dueño sí la recibe en sus alertas; otro tripulante, no.
  const own = (await ownEscalations('orion')).find((e) => e.id === escalationId);
  assert.ok(own, 'ORION recibe su alerta de sueño por sync');
  assert.equal(own.level, 'crew');
  assert.ok(!(await ownEscalations('vega')).some((e) => e.id === escalationId), 'VEGA no');
});

test('astronauta sin asignación vigente → 403 NO_ACTIVE_ASSIGNMENT', async (t) => {
  if (skip(t)) return;
  await q(`UPDATE crew_assignments SET assigned_to = now() WHERE astronaut_id = $1`, [A.lyra]);
  const res = await api('lyra', 'get', '/crew/status');
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body.error.code, 'NO_ACTIVE_ASSIGNMENT');
  // Y ya no sale en el roster de los demás.
  const body = await status('vega');
  assert.equal(member(body, A.lyra), undefined);
});
