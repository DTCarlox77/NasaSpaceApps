#!/usr/bin/env node
/**
 * Prueba de humo de la integración app ↔ API (sin dependencias; Node 18+).
 * NUNCA imprime tokens. NO abre emergencias (la base de Render es compartida).
 *
 *   node scripts/check-api.mjs                     # contra Render
 *   node scripts/check-api.mjs --api http://192.168.1.10:3000
 *   API_URL=https://… node scripts/check-api.mjs
 *
 * Pasos (los mismos endpoints que usa la app):
 *   1. GET  /health                (timeout 60 s: Render se duerme)
 *   2. POST /auth/login            a.ortega / Demo2026! (usuario sintético del seed)
 *   3. GET  /me/body-status
 *   4. POST /readings              HEART_RATE normal (72 lpm en reposo)
 *   5. POST /wellbeing/checkins    check-in de ejemplo (deslizadores en 50)
 *   6. GET  /me/wellbeing
 *   7. POST /auth/logout           revoca el refresh de este dispositivo
 *
 * Datos que deja (sintéticos, con client_uuid nuevos en cada corrida): una lectura HEART_RATE de ORION y
 * su check-in de hoy (si ya había uno hoy, el servidor lo CORRIGE: un check-in por día UTC).
 */
import { randomUUID } from 'node:crypto';

const argApi = process.argv.indexOf('--api');
const HOST = (argApi > -1 ? process.argv[argApi + 1] : process.env.API_URL || 'https://astro-health-api-81jd.onrender.com')
  .replace(/\/+$/, '')
  .replace(/\/api\/v1$/, '');
const API = `${HOST}/api/v1`;
const USER = process.env.CHECK_USER || 'a.ortega';
const PASSWORD = process.env.CHECK_PASSWORD || 'Demo2026!';
const DEVICE = `check-api-${randomUUID().slice(0, 8)}`;

let token = null;
let failures = 0;

async function call(method, path, { body, timeoutMs = 15000, auth = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const t0 = Date.now();
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ms: Date.now() - t0, json };
}

function step(n, label, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'OK ' : 'ERR'} ${n}. ${label}${detail ? ` — ${detail}` : ''}`);
}

const errCode = (r) => r.json?.error?.code ?? `HTTP ${r.status}`;

try {
  console.log(`API: ${API} · usuario: ${USER} · device_id: ${DEVICE}\n`);

  const h = await call('GET', '/health', { auth: false, timeoutMs: 60000 });
  step(1, 'GET /health', h.status === 200 && h.json?.status === 'ok', `${h.json?.status ?? h.status} · db ${h.json?.db} · ${h.ms} ms`);

  const login = await call('POST', '/auth/login', { auth: false, body: { username: USER, password: PASSWORD, device_id: DEVICE } });
  token = login.json?.access_token ?? null;
  const ctx = login.json?.context;
  step(2, 'POST /auth/login', login.status === 200 && !!token,
    login.status === 200 ? `${ctx?.call_sign} · ${ctx?.crew_role} · misión ${ctx?.mission?.code} (tokens recibidos, no se imprimen)` : errCode(login));
  if (!token) throw new Error('sin token: no se puede seguir');

  const bs = await call('GET', '/me/body-status');
  const zones = (bs.json?.zones ?? []).map((z) => `${z.zone}:${z.worst_level}`).join(' ');
  step(3, 'GET /me/body-status', bs.status === 200, bs.status === 200 ? zones : errCode(bs));

  const readingUuid = randomUUID();
  const rd = await call('POST', '/readings', {
    body: {
      client_uuid: readingUuid,
      indicator_code: 'HEART_RATE',
      measured_at: new Date(Date.now() - 60_000).toISOString(),
      values: { value: 72, at_rest: true },
      input_method: 'manual',
      device_id: DEVICE,
    },
  });
  step(4, 'POST /readings (HEART_RATE 72 lpm)', rd.status === 201 || rd.status === 200,
    rd.json?.evaluation ? `${rd.status} · nivel ${rd.json.evaluation.level} · escalation_id ${rd.json.escalation_id ?? 'null'} · "${rd.json.evaluation.recommendation ?? ''}"` : errCode(rd));

  const checkinUuid = randomUUID();
  const ci = await call('POST', '/wellbeing/checkins', {
    body: { client_uuid: checkinUuid, measured_at: new Date().toISOString(), mood: 50, fatigue: 50, stress: 50, crew_conflict: 50 },
  });
  step(5, 'POST /wellbeing/checkins', ci.status === 201 || ci.status === 200,
    ci.json?.message ? `${ci.status} · "${ci.json.message}" · racha ${ci.json.streak?.streak_days ?? '—'} · corrige ${ci.json.supersedes_id ?? 'nada'}` : errCode(ci));

  const wb = await call('GET', '/me/wellbeing?limit=5');
  step(6, 'GET /me/wellbeing', wb.status === 200, wb.status === 200 ? `${wb.json?.items?.length ?? 0} registros recientes (${(wb.json?.items ?? []).map((i) => i.kind).join(', ')})` : errCode(wb));

  const cs = await call('GET', '/crew/status');
  console.log(`--- GET /crew/status → ${cs.status === 404 ? '404 (aún no existe: la app muestra "Disponible pronto")' : cs.status}`);

  const lo = await call('POST', '/auth/logout', { body: { device_id: DEVICE } });
  step(7, 'POST /auth/logout', lo.status === 204, `${lo.status}`);

  console.log(`\nDatos que dejó: lectura HEART_RATE client_uuid ${readingUuid}${rd.json?.reading?.id ? ` (id ${rd.json.reading.id})` : ''}; check-in client_uuid ${checkinUuid}${ci.json?.id ? ` (id ${ci.json.id})` : ''}.`);
} catch (e) {
  failures++;
  console.error(`ERR ${e instanceof Error ? e.message : e}`);
}

console.log(failures ? `\n${failures} paso(s) con error.` : '\nTodo OK.');
process.exit(failures ? 1 : 0);
