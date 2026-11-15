'use strict';

/**
 * Prueba de humo de la API desplegada (tarea 12). Recorre el camino de la demo con los
 * usuarios SINTÉTICOS del seed y termina con una tabla de pasos; sale con código 1 si algo
 * falla. Nunca imprime tokens ni credenciales (los cuerpos que muestra pasan por redact).
 *
 *   npm run smoke -- --base=https://astro-health-api-81jd.onrender.com/api/v1
 *   npm run smoke                       (por defecto http://localhost:3000/api/v1)
 *   npm run smoke -- --base=<url> --quick
 *
 * --quick: no espera el retraso de la misión (~90 s en ARES-1). Se salta lo que depende de
 * deliver_at: que la SpO₂ llegue a la bandeja del flight surgeon y la bandeja de bh.salas (y
 * por eso no puede cerrar su solicitud de apoyo, que queda abierta para el reinicio de demo).
 * Mantiene todo lo demás, incluidos los chequeos de confidencialidad que no esperan.
 *
 * Opcional por variable de entorno: SMOKE_PASSWORD (Demo2026!) y SMOKE_DEVICE_CREDENTIAL
 * (la de TAB-1 del seed; cámbiala si registraste tabletas nuevas).
 *
 * La base es compartida: NO abre emergencias. La lectura crítica se mide hace 4 h (más que
 * TRIAGE_AUTO_READING_MAX_AGE_MIN = 120 min: escala, pero no activa el triaje) y se corrige
 * enseguida (el panel no la muestra). Usa client_uuid propios de cada corrida y cierra su
 * solicitud de apoyo. Lo que deja (el escalamiento de la lectura crítica, el check-in de hoy de
 * ORION, el lote del ejemplo de sync) lo cierra `npm run demo:reset` / POST /admin/demo/reset.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { redact } = require('../src/utils/safeLog');

const DEFAULT_BASE = 'http://localhost:3000/api/v1';
const PASSWORD = process.env.SMOKE_PASSWORD || 'Demo2026!';
const DEVICE_CREDENTIAL = process.env.SMOKE_DEVICE_CREDENTIAL || 'dc_demo_tab1_sintetica';
const DEVICE_ID = 'smoke-test';
const CRITICAL_AGE_MIN = 240;
const DELIVERY_TIMEOUT_MS = 240000;
const HEALTH_TIMEOUT_MS = 180000;

// ---------------------------------------------------------------- argumentos y HTTP

function baseUrl(argv) {
  let raw = DEFAULT_BASE;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--base=')) raw = argv[i].slice(7);
    else if (argv[i] === '--base' && argv[i + 1]) raw = argv[i + 1];
  }
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
}

const ARGS = process.argv.slice(2);
const API = baseUrl(ARGS);
const QUICK = ARGS.includes('--quick');
const STARTED_AT = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clock = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.error(clock(), ...a);

async function call(method, url, { token, body, headers = {}, timeoutMs = 120000 } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined) h['Content-Type'] = 'application/json; charset=utf-8';
  try {
    const res = await fetch(`${API}${url}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* sin JSON */
    }
    return { status: res.status, json, text };
  } catch (err) {
    return { status: 0, json: null, text: `error de red: ${err.message}` };
  }
}

// ---------------------------------------------------------------- tabla

const rows = [];
const failures = [];

function record(step, request, expected, res, ok, note = '') {
  const status = res ? res.status : '-';
  rows.push({ step, request, expected, status, ok, note });
  if (!ok) {
    failures.push({
      step,
      request,
      status,
      body: res && res.text ? redact(res.text).slice(0, 600) : '',
      note,
    });
  }
  log(`${ok ? 'OK   ' : 'FALLA'} ${step} ${request} → ${status}${note ? ` (${note})` : ''}`);
  return ok;
}

function printTable() {
  const head = ['#', 'Paso', 'Esperado', 'HTTP', 'Resultado', 'Nota'];
  const data = rows.map((r) => [
    r.step,
    r.request,
    r.expected,
    String(r.status),
    r.ok ? 'OK' : 'FALLA',
    r.note,
  ]);
  const widths = head.map((h, i) =>
    Math.min(i === 5 ? 70 : 60, Math.max(h.length, ...data.map((d) => d[i].length))),
  );
  const cut = (s, w) => (s.length > w ? `${s.slice(0, w - 1)}…` : s.padEnd(w));
  const line = (cells) => `| ${cells.map((c, i) => cut(c, widths[i])).join(' | ')} |`;
  console.log(`\nPrueba de humo contra ${API}${QUICK ? ' (--quick)' : ''}\n`);
  if (QUICK) {
    console.log(
      'Modo --quick: sin esperar el retraso de la misión. No comprueba la llegada a Tierra ni la ' +
        'bandeja de bh.salas, y la solicitud de apoyo queda abierta: corre el reinicio de demo ' +
        'después.\n',
    );
  }
  console.log(line(head));
  console.log(`|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`);
  for (const d of data) console.log(line(d));
  const ok = rows.filter((r) => r.ok).length;
  const seconds = Math.round((Date.now() - STARTED_AT) / 1000);
  console.log(
    `\n${ok}/${rows.length} pasos OK en ${seconds} s${failures.length ? ` · ${failures.length} FALLA` : ''}`,
  );
  for (const f of failures) {
    console.log(
      `\nFALLA en ${f.step} ${f.request} (HTTP ${f.status})${f.note ? `: ${f.note}` : ''}`,
    );
    if (f.body) console.log(`  respuesta: ${f.body}`);
  }
}

// ---------------------------------------------------------------- pasos

const tokens = {};

async function login(username) {
  const res = await call('POST', '/auth/login', {
    body: { username, password: PASSWORD, device_id: DEVICE_ID },
  });
  const ok = res.status === 200 && res.json && typeof res.json.access_token === 'string';
  if (ok) tokens[username] = res.json.access_token;
  // Nunca se guarda ni se imprime el body del login (trae tokens).
  // Si falla, la tabla muestra solo el error (un 200 nunca llega a la tabla de fallas).
  if (!ok) res.text = res.json && res.json.error ? JSON.stringify(res.json.error) : res.text;
  record('2', `POST /auth/login (${username})`, '200', res, ok, ok ? 'token recibido' : '');
  return ok;
}

async function waitHealth() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let res;
  for (;;) {
    res = await call('GET', '/health', { timeoutMs: 90000 });
    if (res.status === 200 && res.json && res.json.db === 'up') break;
    if (Date.now() > deadline) break;
    log(`health → ${res.status}; la API puede estar despertando, reintento en 10 s`);
    await sleep(10000);
  }
  const ok = res.status === 200 && res.json && res.json.status === 'ok' && res.json.db === 'up';
  return record('1', 'GET /health', '200, status ok, db up', res, ok);
}

/** Espera a que `find(items)` aparezca en una bandeja paginada (llega tras el retraso). */
async function waitInInbox(url, token, find) {
  const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
  let last;
  for (;;) {
    let cursor = null;
    for (let page = 0; page < 10; page += 1) {
      last = await call(
        'GET',
        `${url}${url.includes('?') ? '&' : '?'}limit=200${cursor ? `&cursor=${cursor}` : ''}`,
        {
          token,
        },
      );
      if (last.status !== 200 || !last.json) return { res: last, item: null };
      const item = last.json.items.find(find);
      if (item) return { res: last, item };
      cursor = last.json.next_cursor;
      if (!cursor) break;
    }
    if (Date.now() > deadline) return { res: last, item: null };
    await sleep(10000);
  }
}

async function openEmergencyIds(token) {
  const res = await call('GET', '/admin/emergencies?limit=100', { token });
  if (res.status !== 200 || !res.json) return null;
  return new Set(
    res.json.items.filter((e) => ['pending', 'active'].includes(e.status)).map((e) => e.id),
  );
}

async function main() {
  const runId = crypto.randomUUID();
  const now = () => new Date().toISOString();
  log(`prueba de humo ${runId.slice(0, 8)} contra ${API}`);

  // 1. Salud (despierta la API si dormía).
  if (!(await waitHealth())) return;

  // 2. Logins.
  for (const u of ['a.ortega', 'dr.reyes', 'bh.salas', 'mission.control', 'k.mensah']) {
    await login(u);
  }
  const orion = tokens['a.ortega'];
  const surgeon = tokens['dr.reyes'];
  if (!orion) return;
  const emergenciesBefore = surgeon ? await openEmergencyIds(surgeon) : null;

  // 3. Lecturas: normal, crítica vieja (no abre emergencia) y su corrección.
  const normal = await call('POST', '/readings', {
    token: orion,
    body: {
      client_uuid: crypto.randomUUID(),
      indicator_code: 'HEART_RATE',
      measured_at: now(),
      values: { value: 68, at_rest: true, symptoms: [] },
      input_method: 'wearable',
      device_id: DEVICE_ID,
    },
  });
  const nb = normal.json || {};
  record(
    '3',
    'POST /readings (HEART_RATE 68, normal)',
    '201, level normal',
    normal,
    normal.status === 201 && nb.evaluation && nb.evaluation.level === 'normal',
    nb.evaluation ? `level=${nb.evaluation.level}` : '',
  );

  const criticalUuid = crypto.randomUUID();
  const measuredAt = new Date(Date.now() - CRITICAL_AGE_MIN * 60000).toISOString();
  const critical = await call('POST', '/readings', {
    token: orion,
    body: {
      client_uuid: criticalUuid,
      indicator_code: 'SPO2',
      measured_at: measuredAt,
      values: { value: 88 },
      input_method: 'wearable',
      device_id: DEVICE_ID,
      note: 'Prueba de humo (sintética)',
    },
  });
  const cb = critical.json || {};
  const escalationId = cb.escalation_id || null;
  record(
    '3',
    `POST /readings (SPO2 88, medida hace ${CRITICAL_AGE_MIN / 60} h)`,
    '201, critical, escala, sin emergencia',
    critical,
    critical.status === 201 &&
      cb.evaluation &&
      cb.evaluation.level === 'critical' &&
      Boolean(escalationId) &&
      !cb.emergency,
    cb.evaluation
      ? `level=${cb.evaluation.level}; escalation=${escalationId ? 'sí' : 'no'}; emergencia=${cb.emergency ? 'ABIERTA' : 'no'}`
      : '',
  );
  const correction = await call('POST', '/readings', {
    token: orion,
    body: {
      client_uuid: crypto.randomUUID(),
      supersedes_uuid: criticalUuid,
      indicator_code: 'SPO2',
      measured_at: measuredAt,
      values: { value: 97 },
      input_method: 'wearable',
      device_id: DEVICE_ID,
      note: 'Prueba de humo: corrige la anterior',
    },
  });
  const xb = correction.json || {};
  record(
    '3',
    'POST /readings (corrige la SPO2 con 97)',
    '201, normal',
    correction,
    correction.status === 201 && xb.evaluation && xb.evaluation.level === 'normal',
    xb.evaluation ? `level=${xb.evaluation.level}` : '',
  );

  // 4. Estado del cuerpo.
  const body = await call('GET', '/me/body-status', { token: orion });
  record('4', 'GET /me/body-status', '200', body, body.status === 200 && Boolean(body.json));

  // 5. Sync: el lote del ejemplo (el device_id del sobre es el de esta sesión).
  const example = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../docs/examples/sync-push.json'), 'utf8'),
  );
  const push = await call('POST', '/sync/push', {
    token: orion,
    body: { ...example, device_id: DEVICE_ID, sent_at: now() },
  });
  const pb = push.json || {};
  const results = Array.isArray(pb.results) ? pb.results : [];
  const bad = results.filter((r) => !['accepted', 'duplicate'].includes(r.status));
  const opened = results.filter((r) => r.result && r.result.emergency);
  record(
    '5',
    `POST /sync/push (ejemplo, ${example.items.length} items)`,
    '200, accepted/duplicate, sin emergencia',
    push,
    push.status === 200 && results.length === example.items.length && !bad.length && !opened.length,
    pb.counts
      ? `counts=${JSON.stringify(pb.counts)}${bad.length ? `; ${bad.map((r) => r.error && r.error.code).join(',')}` : ''}`
      : '',
  );
  const pull = await call('GET', '/sync/pull?limit=50', { token: orion });
  const lb = pull.json || {};
  record(
    '5',
    'GET /sync/pull',
    '200 con cursor',
    pull,
    pull.status === 200 && typeof lb.cursor === 'string',
    pull.json ? `has_more=${lb.has_more}` : '',
  );

  // 6. Bienestar: check-in y "Quiero hablar con alguien".
  const checkin = await call('POST', '/wellbeing/checkins', {
    token: orion,
    body: {
      client_uuid: crypto.randomUUID(),
      measured_at: now(),
      mood: 70,
      fatigue: 30,
      stress: 28,
      crew_conflict: 12,
      sleep_hours: 7.2,
    },
  });
  const kb = checkin.json || {};
  const leaked = ['mood', 'fatigue', 'stress', 'crew_conflict', 'level', 'score'].filter(
    (k) => k in kb,
  );
  record(
    '6',
    'POST /wellbeing/checkins',
    '201, message neutro, sin valores',
    checkin,
    checkin.status === 201 &&
      typeof kb.message === 'string' &&
      !/\d/.test(kb.message) &&
      kb.offer_support === true &&
      !leaked.length,
    checkin.json
      ? `corrige el de hoy=${kb.supersedes_id ? 'sí' : 'no'}; valores en la respuesta=${leaked.join(',') || 'ninguno'}`
      : '',
  );
  const support = await call('POST', '/wellbeing/support-requests', {
    token: orion,
    body: {
      client_uuid: crypto.randomUUID(),
      urgency: 'later',
      channel: 'message',
      content: 'Prueba de humo (sintética): ignorar.',
      created_at: now(),
    },
  });
  const sb = support.json || {};
  record(
    '6',
    'POST /wellbeing/support-requests',
    '201',
    support,
    support.status === 201 && Boolean(sb.id),
    [sb.deliver_at ? `deliver_at=${sb.deliver_at}` : '', QUICK ? 'queda abierta (--quick)' : '']
      .filter(Boolean)
      .join('; '),
  );

  // 7. Tierra: la bandeja del flight surgeon responde; sin --quick, además espera el retraso y
  // comprueba que llegan la SpO₂ (flight surgeon) y la solicitud de apoyo (bh.salas).
  if (surgeon) {
    const inbox = await call('GET', '/admin/inbox', { token: surgeon });
    record('7', 'GET /admin/inbox (dr.reyes)', '200', inbox, inbox.status === 200);
  }
  if (QUICK) {
    log('--quick: no se espera el retraso (llegada a Tierra y bandeja de bh.salas)');
  } else {
    log('esperando a que llegue a Tierra (retraso de ARES-1, ~90 s)...');
  }
  if (!QUICK && surgeon) {
    if (escalationId) {
      const { res, item } = await waitInInbox(
        '/admin/inbox',
        surgeon,
        (i) => i.id === escalationId,
      );
      record(
        '7',
        'GET /admin/inbox: llega la SPO2 crítica',
        'aparece tras el retraso',
        res,
        Boolean(item),
        item
          ? `level=${item.level}; late_sync=${item.late_sync}; deliver_at=${item.deliver_at}`
          : '',
      );
    }
  }
  if (!QUICK && tokens['bh.salas'] && sb.id) {
    const { res, item } = await waitInInbox(
      '/admin/behavioral/inbox',
      tokens['bh.salas'],
      (i) => i.id === sb.id,
    );
    record(
      '7',
      'GET /admin/behavioral/inbox (bh.salas)',
      '200, aparece la solicitud',
      res,
      Boolean(item),
      item ? `kind=${item.kind}; urgency=${item.urgency}` : '',
    );
    const close = await call('POST', `/admin/behavioral/support-requests/${sb.id}/close`, {
      token: tokens['bh.salas'],
      body: {},
    });
    record(
      '7',
      'POST .../support-requests/{id}/close (bh.salas)',
      '200',
      close,
      close.status === 200,
    );
  }

  // 8. Confidencialidad.
  for (const u of ['mission.control', 'k.mensah', 'dr.reyes']) {
    if (!tokens[u]) continue;
    const r = await call('GET', '/admin/behavioral/inbox', { token: tokens[u] });
    record('8', `GET /admin/behavioral/inbox (${u})`, '403', r, r.status === 403);
  }
  if (tokens['mission.control']) {
    const comp = await call('GET', '/admin/compliance', { token: tokens['mission.control'] });
    const text = comp.text || '';
    const forbidden = [
      'WB_',
      'PVT_',
      'PHQ',
      'GAD',
      'mood',
      'fatigue',
      'stress',
      'crew_conflict',
      'private_note',
      'urgency',
      'content',
      'score',
    ].filter((w) => text.includes(w));
    record(
      '8',
      'GET /admin/compliance (mission.control)',
      '200, sin valores de bienestar',
      comp,
      comp.status === 200 && !forbidden.length,
      `prohibidos encontrados: ${forbidden.join(',') || 'ninguno'}`,
    );
  }

  // 9. Credencial de tableta: sirve para el protocolo del triaje, nunca como sesión.
  const header = { 'X-Device-Credential': DEVICE_CREDENTIAL };
  const protocol = await call('GET', '/emergency/protocol', { headers: header });
  record(
    '9',
    'GET /emergency/protocol (X-Device-Credential)',
    '200',
    protocol,
    protocol.status === 200,
  );
  const me = await call('GET', '/me', { headers: header });
  record('9', 'GET /me (X-Device-Credential)', '401', me, me.status === 401);

  // 10. Ninguna emergencia nueva abierta.
  if (surgeon && emergenciesBefore) {
    const after = await openEmergencyIds(surgeon);
    const added = after ? [...after].filter((id) => !emergenciesBefore.has(id)) : null;
    record(
      '10',
      'GET /admin/emergencies (abiertas)',
      'ninguna nueva',
      { status: after ? 200 : 0, text: '' },
      Array.isArray(added) && added.length === 0,
      added && added.length ? `nuevas: ${added.length}` : '',
    );
  }
}

main()
  .catch((err) => {
    rows.push({
      step: '!',
      request: 'script',
      expected: '-',
      status: '-',
      ok: false,
      note: err.message,
    });
    failures.push({
      step: '!',
      request: 'script',
      status: '-',
      body: '',
      note: redact(err.message),
    });
  })
  .finally(() => {
    printTable();
    process.exitCode = failures.length || !rows.length ? 1 : 0;
  });
