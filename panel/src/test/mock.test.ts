/**
 * Modo demo sin servidor: el adaptador de src/api/mock/ responde como la API (rutas, esquemas,
 * errores) y aplica las mismas reglas de acceso del contrato. Sin red.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureMock, handleMockRequest, resetMockState } from '../api/mock/server.ts';
import { ESC } from '../api/mock/fixtures/inbox.ts';
import { EMERGENCY } from '../api/mock/fixtures/emergencies.ts';
import { MISSION_ID } from '../api/mock/fixtures/mission.ts';
import { isMockMode, resolveDataMode } from '../config/env.ts';
import { request } from '../api/http.ts';
import * as storage from '../auth/storage.ts';
import type {
  BehavioralAstronautDetail,
  CrewDashboard,
  EmergencyDetail,
  EmergencyListPage,
  EscalationMessagePage,
  InboxPage,
  LoginResponse,
} from '../api/types.ts';

const T0 = Date.parse('2026-11-15T12:00:00Z');
const VEGA = '10000000-0000-4000-8000-000000000012';

beforeEach(() => resetMockState(T0));

async function call<T = unknown>(
  method: string,
  path: string,
  bearer: string | null,
  body?: unknown,
  now = T0 + 1_000,
): Promise<{ status: number; data: T }> {
  const response = handleMockRequest({ method, path, bearer, body }, now);
  const text = await response.text();
  return { status: response.status, data: (text ? JSON.parse(text) : undefined) as T };
}

async function loginAs(username: string): Promise<string> {
  const { status, data } = await call<LoginResponse>('POST', '/auth/login', null, {
    username,
    password: 'cualquiera',
  });
  expect(status).toBe(200);
  return data.access_token;
}

describe('modo demo: configuración', () => {
  it('VITE_DATA_MODE: api por defecto, mock y error claro si es otro valor', () => {
    expect(resolveDataMode(undefined)).toBe('api');
    expect(resolveDataMode('')).toBe('api');
    expect(resolveDataMode('MOCK')).toBe('mock');
    expect(() => resolveDataMode('demo')).toThrow(/VITE_DATA_MODE/);
  });
});

describe('modo demo: login', () => {
  it('los tres usuarios de Tierra entran con cualquier contraseña no vacía', async () => {
    for (const [username, role] of [
      ['mission.control', 'admin'],
      ['dr.reyes', 'flight_surgeon'],
      ['bh.salas', 'behavioral_health'],
    ]) {
      const { status, data } = await call<LoginResponse>('POST', '/auth/login', null, { username, password: 'x' });
      expect(status).toBe(200);
      expect(data.user.role).toBe(role);
      expect(data.context.ground_missions?.[0]?.code).toBe('ARES-1');
    }
  });

  it('contraseña vacía → 400; usuario desconocido → 401 INVALID_CREDENTIALS', async () => {
    expect((await call('POST', '/auth/login', null, { username: 'dr.reyes', password: '' })).status).toBe(400);
    const unknown = await call<{ error: { code: string } }>('POST', '/auth/login', null, { username: 'no.existe', password: 'x' });
    expect(unknown.status).toBe(401);
    expect(unknown.data.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('un astronauta entra en la API (rol astronaut) para que el panel lo rechace como hoy', async () => {
    const { data } = await call<LoginResponse>('POST', '/auth/login', null, { username: 'a.ortega', password: 'x' });
    expect(data.user.role).toBe('astronaut');
  });

  it('sin token → 401 UNAUTHENTICATED; el refresh rotativo devuelve tokens nuevos', async () => {
    const anonymous = await call<{ error: { code: string } }>('GET', '/admin/inbox', null);
    expect(anonymous.status).toBe(401);
    expect(anonymous.data.error.code).toBe('UNAUTHENTICATED');
    const login = await call<LoginResponse>('POST', '/auth/login', null, { username: 'dr.reyes', password: 'x' });
    const refreshed = await call<LoginResponse>('POST', '/auth/refresh', null, { refresh_token: login.data.refresh_token });
    expect(refreshed.status).toBe(200);
    expect(refreshed.data.refresh_token).not.toBe(login.data.refresh_token);
  });
});

describe('modo demo: reglas de acceso del contrato', () => {
  const BEHAVIORAL_CALLS: [string, string][] = [
    ['GET', `/admin/behavioral/inbox?mission_id=${MISSION_ID}`],
    ['GET', `/admin/behavioral/astronauts/${VEGA}`],
    ['GET', `/admin/audit/confidential-access?mission_id=${MISSION_ID}`],
    ['POST', '/admin/behavioral/support-requests/a1000000-0000-4000-8000-000000000001/ack'],
    ['POST', '/admin/behavioral/support-requests/a1000000-0000-4000-8000-000000000001/close'],
    ['POST', '/admin/behavioral/support-requests/a1000000-0000-4000-8000-000000000001/messages'],
    ['POST', '/admin/behavioral/escalations/60000000-0000-4000-8000-000000000221/ack'],
    ['POST', '/admin/behavioral/escalations/60000000-0000-4000-8000-000000000221/close'],
  ];

  it('admin y flight_surgeon → 403 en TODO lo conductual (y la auditoría)', async () => {
    for (const username of ['mission.control', 'dr.reyes']) {
      const token = await loginAs(username);
      for (const [method, path] of BEHAVIORAL_CALLS) {
        const { status, data } = await call<{ error: { code: string } }>(method, path, token, { body: 'hola' });
        expect([username, method, path, status]).toEqual([username, method, path, 403]);
        expect(data.error.code).toBe('FORBIDDEN');
      }
    }
  });

  it('behavioral_health → 403 en el dashboard, la bandeja de Tierra y las emergencias', async () => {
    const token = await loginAs('bh.salas');
    for (const path of ['/admin/dashboard/crew', '/admin/inbox', '/admin/emergencies']) {
      expect((await call('GET', `${path}?mission_id=${MISSION_ID}`, token)).status).toBe(403);
    }
  });

  it('admin: 403 en hilo, acuse y respuesta de una emergencia, de bienestar y de SLEEP_HOURS', async () => {
    const token = await loginAs('mission.control');
    for (const id of [ESC.triageLyra, ESC.question, ESC.wellbeingLyra, ESC.sleepAtlas]) {
      expect((await call('GET', `/admin/escalations/${id}/messages`, token)).status).toBe(403);
      expect((await call('POST', `/admin/escalations/${id}/ack`, token)).status).toBe(403);
      expect((await call('POST', `/admin/escalations/${id}/messages`, token, { body: 'x' })).status).toBe(403);
    }
    // Una lectura sí (contrato: flight_surgeon y admin).
    expect((await call('GET', `/admin/escalations/${ESC.bpOrion}/messages`, token)).status).toBe(200);
  });

  it('admin: la bandeja no trae bienestar, SLEEP_HOURS ni triage; el flight surgeon sí', async () => {
    const admin = await call<InboxPage>('GET', `/admin/inbox?mission_id=${MISSION_ID}`, await loginAs('mission.control'));
    const ids = admin.data.items.map((i) => i.id);
    expect(ids).not.toContain(ESC.wellbeingLyra);
    expect(ids).not.toContain(ESC.sleepAtlas);
    expect(admin.data.items.some((i) => i.triage)).toBe(false);
    expect(ids).toContain(ESC.triageLyra);

    const fs = await call<InboxPage>('GET', `/admin/inbox?mission_id=${MISSION_ID}`, await loginAs('dr.reyes'));
    const fsIds = fs.data.items.map((i) => i.id);
    expect(fsIds).toContain(ESC.wellbeingLyra);
    expect(fsIds).toContain(ESC.sleepAtlas);
    expect(fs.data.items.find((i) => i.id === ESC.triageLyra)?.triage?.triage_category).toBe('red');
  });

  it('dashboard: compliance null para el flight surgeon, con valor para admin; nunca SLEEP_HOURS', async () => {
    const fs = await call<CrewDashboard>('GET', `/admin/dashboard/crew?mission_id=${MISSION_ID}`, await loginAs('dr.reyes'));
    expect(fs.data.astronauts.every((a) => a.compliance === null)).toBe(true);
    const admin = await call<CrewDashboard>('GET', `/admin/dashboard/crew?mission_id=${MISSION_ID}`, await loginAs('mission.control'));
    expect(admin.data.astronauts.every((a) => a.compliance !== null)).toBe(true);
    const codes = admin.data.astronauts.flatMap((a) => a.indicators.map((i) => i.code));
    expect(codes).not.toContain('SLEEP_HOURS');
    expect(admin.data.astronauts.map((a) => a.worst_level)).toContain('critical');
    expect(admin.data.astronauts.map((a) => a.worst_level)).toContain('caution');
  });

  it('emergencias: admin sin counts, sin respuestas, categorías, preguntas, orden de atención ni reporte', async () => {
    const token = await loginAs('mission.control');
    const list = await call<EmergencyListPage>('GET', `/admin/emergencies?mission_id=${MISSION_ID}`, token);
    expect(list.data.items.every((i) => i.counts === null)).toBe(true);
    const detail = await call<EmergencyDetail>('GET', `/admin/emergencies/${EMERGENCY.closed}`, token);
    expect(detail.data.report).toBeNull();
    expect(detail.data.attention_order).toBeUndefined();
    expect(detail.data.questions).toBeUndefined();
    for (const a of detail.data.assessments) {
      expect(a.answers).toBeUndefined();
      expect(a.triage_category).toBeUndefined();
      expect(a.radiation_flag).toBeUndefined();
    }
    const completed = detail.data.timeline.filter((e) => e.event_type === 'assessment_completed');
    expect(completed.length).toBeGreaterThan(0);
    expect(completed.every((e) => e.details === undefined)).toBe(true);
  });

  it('emergencias: el flight surgeon recibe el detalle clínico, las preguntas y el reporte al cierre', async () => {
    const token = await loginAs('dr.reyes');
    const list = await call<EmergencyListPage>('GET', `/admin/emergencies?mission_id=${MISSION_ID}`, token);
    expect(list.data.items.map((i) => i.status)).toEqual(['active', 'closed', 'cancelled']);
    expect(list.data.items[0]?.counts).toEqual({ green: 1, yellow: 1, red: 1, black: 0, unreachable: 0, in_progress: 1 });
    const active = await call<EmergencyDetail>('GET', `/admin/emergencies/${EMERGENCY.active}`, token);
    expect(active.data.attention_order?.[0]?.call_sign).toBe('LYRA');
    expect(active.data.questions?.find((q) => q.direction === 'to_earth')?.escalation_id).toBe(ESC.question);
    expect(active.data.session.heartbeat?.last_heartbeat_at).toBeTruthy();
    const closed = await call<EmergencyDetail>('GET', `/admin/emergencies/${EMERGENCY.closed}`, token);
    expect(closed.data.report).not.toBeNull();
  });
});

describe('modo demo: retraso y escrituras en memoria', () => {
  it('la bandeja solo muestra lo que ya llegó; lo que viaja aparece cuando llega', async () => {
    const token = await loginAs('dr.reyes');
    const before = await call<InboxPage>('GET', `/admin/inbox?mission_id=${MISSION_ID}`, token, undefined, T0 + 1_000);
    expect(before.data.items.map((i) => i.id)).not.toContain(ESC.tempLyraIncoming);
    const after = await call<InboxPage>('GET', `/admin/inbox?mission_id=${MISSION_ID}`, token, undefined, T0 + 3 * 60_000);
    const incoming = after.data.items.find((i) => i.id === ESC.tempLyraIncoming);
    expect(incoming?.status).toBe('delivered');
    expect(incoming?.late_sync).toBe(false);
  });

  it('respuesta: 201 con deliver_at = ahora + 90 s; queda en el hilo y la alerta pasa a responded', async () => {
    const token = await loginAs('dr.reyes');
    const now = T0 + 5_000;
    const sent = await call<{ deliver_at: string; body: string }>(
      'POST', `/admin/escalations/${ESC.triageLyra}/messages`, token, { body: '  Recibido.  ' }, now,
    );
    expect(sent.status).toBe(201);
    expect(sent.data.body).toBe('Recibido.');
    expect(Date.parse(sent.data.deliver_at)).toBe(now + 90_000);
    const thread = await call<EscalationMessagePage>('GET', `/admin/escalations/${ESC.triageLyra}/messages`, token, undefined, now);
    expect(thread.data.items.map((m) => m.body)).toContain('Recibido.');
    const inbox = await call<InboxPage>('GET', `/admin/inbox?mission_id=${MISSION_ID}&status=responded`, token, undefined, now);
    expect(inbox.data.items.map((i) => i.id)).toContain(ESC.triageLyra);
  });

  it('el hilo trae los tres estados de entrega y un escalamiento cerrado responde 409', async () => {
    const token = await loginAs('dr.reyes');
    const thread = await call<EscalationMessagePage>('GET', `/admin/escalations/${ESC.question}/messages`, token);
    const toCrew = thread.data.items.filter((m) => m.direction === 'to_crew').map((m) => m.deliver_at);
    expect(toCrew.some((d) => d == null)).toBe(true);
    expect(toCrew.some((d) => d != null && Date.parse(d) > T0 + 1_000)).toBe(true);
    expect(toCrew.some((d) => d != null && Date.parse(d) <= T0 + 1_000)).toBe(true);

    const closedThread = await call<EscalationMessagePage>('GET', `/admin/escalations/${ESC.closedQuestion}/messages`, token);
    expect(closedThread.status).toBe(200);
    const reply = await call<{ error: { code: string } }>('POST', `/admin/escalations/${ESC.closedQuestion}/messages`, token, { body: 'x' });
    expect(reply.status).toBe(409);
    expect(reply.data.error.code).toBe('CONFLICT');
  });
});

describe('modo demo: salud conductual', () => {
  it('el detalle nunca trae la nota privada del check-in', async () => {
    const token = await loginAs('bh.salas');
    const response = handleMockRequest({ method: 'GET', path: `/admin/behavioral/astronauts/${VEGA}`, bearer: token }, T0);
    const raw = await response.text();
    expect(raw).not.toMatch(/note/i);
    const detail = JSON.parse(raw) as BehavioralAstronautDetail;
    expect(detail.checkins?.length).toBe(14);
    expect(detail.indicators.map((i) => i.code)).toEqual(['WB_MOOD', 'WB_FATIGUE', 'WB_STRESS', 'WB_CREW_CONFLICT']);
  });

  it('cada consulta queda en la auditoría de accesos confidenciales', async () => {
    const token = await loginAs('bh.salas');
    await call('GET', `/admin/behavioral/astronauts/${VEGA}`, token);
    const audit = await call<{ items: { call_sign: string; resource: string; actor_username: string }[] }>(
      'GET', `/admin/audit/confidential-access?mission_id=${MISSION_ID}`, token,
    );
    expect(audit.data.items[0]).toMatchObject({
      call_sign: 'VEGA',
      actor_username: 'bh.salas',
      resource: 'GET /api/v1/admin/behavioral/astronauts/{id}',
    });
  });
});

describe('modo demo: el cliente HTTP no sale a la red', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    storage.clearSession();
  });

  it('con VITE_DATA_MODE=mock, request() responde el adaptador y fetch no se llama', async () => {
    vi.stubEnv('VITE_DATA_MODE', 'mock');
    configureMock({ latencyMs: 0 });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(isMockMode()).toBe(true);
    const login = await request<LoginResponse>('/auth/login', {
      method: 'POST',
      auth: false,
      body: { username: 'dr.reyes', password: 'x', device_id: 'panel-test' },
    });
    storage.saveSession({ refresh_token: login.refresh_token, user: login.user, context: login.context }, login.access_token);
    const inbox = await request<InboxPage>(`/admin/inbox?mission_id=${MISSION_ID}`);
    expect(inbox.items.length).toBeGreaterThan(0);
    await expect(request(`/admin/behavioral/inbox?mission_id=${MISSION_ID}`)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
