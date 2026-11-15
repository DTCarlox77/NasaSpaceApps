/** Apoyo de las pruebas: fetch simulado (sin red) y datos sintéticos del seed. */
import { vi } from 'vitest';
import type { LoginResponse, UserContext, UserSummary } from '../api/types.ts';

export const API = 'http://api.test/api/v1';

export function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const apiError = (status: number, code: string, message = code, details: unknown = null) =>
  json(status, { error: { code, message, details } });

export interface Call {
  path: string;
  method: string;
  auth: string | null;
  body: unknown;
}

type Handler = (call: Call) => Response | Promise<Response>;

/** Reemplaza fetch; cada llamada queda en `calls`. */
export function mockFetch(handler: Handler) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = {
      path: url.startsWith(API) ? url.slice(API.length) : url,
      method: init?.method ?? 'GET',
      auth: headers.Authorization ?? null,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal('fetch', fn);
  return { calls, fn };
}

export const MISSION = {
  id: '20000000-0000-4000-8000-000000000001',
  code: 'ARES-1',
  name: 'Ares 1 · Tránsito a Marte (demo)',
  status: 'active' as const,
};

export function user(role: UserSummary['role'], username = 'dr.reyes'): UserSummary {
  return { id: '00000000-0000-4000-8000-000000000002', username, full_name: 'Persona sintética', role };
}

export function groundContext(): UserContext {
  return { astronaut_id: null, call_sign: null, crew_role: null, ground_missions: [MISSION] };
}

export function loginResponse(role: UserSummary['role'], username?: string): LoginResponse {
  return {
    access_token: `at_${role}`,
    token_type: 'Bearer',
    expires_in: 900,
    refresh_token: `rt_${role}`,
    must_change_password: false,
    user: user(role, username),
    context: role === 'astronaut' ? { astronaut_id: 'a', call_sign: 'ORION', mission: MISSION } : groundContext(),
  };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- datos del panel (P2)

export const MISSION_2 = {
  id: '20000000-0000-4000-8000-000000000002',
  code: 'LUNA-2',
  name: 'Luna 2 (demo)',
  status: 'active' as const,
};

/** Ruta sin query string (para enrutar el fetch simulado). */
export const pathOf = (call: Call) => call.path.split('?')[0] ?? call.path;

/** Parámetros de la query string de una llamada. */
export const queryOf = (call: Call) => new URLSearchParams(call.path.split('?')[1] ?? '');

export function currentMission(link: 'up' | 'down' = 'up') {
  return {
    mission: { ...MISSION, environment_code: 'mars_transit', starts_at: '2026-09-30T08:00:00Z' },
    environment: { code: 'mars_transit', name: 'Tránsito a Marte', type: 'spacecraft', gravity_g: 0, comm_delay_seconds: 90 },
    crew_role: null,
    comm: {
      delay_seconds: 90,
      link,
      ...(link === 'down'
        ? { current_outage: { id: 'o1', mission_id: MISSION.id, starts_at: '2026-11-14T08:00:00Z', ends_at: '2026-11-14T20:00:00Z', reason: 'Conjunción solar (demo)' } }
        : {}),
      upcoming_outages: [],
    },
  };
}

export function catalog() {
  return {
    catalog_version: 1,
    rules_version: 1,
    items: [
      { code: 'BLOOD_PRESSURE', name: 'Presión arterial', unit: 'mmHg', value_type: 'composite', components: [{ name: 'systolic', role: 'value', unit: 'mmHg' }, { name: 'diastolic', unit: 'mmHg' }], sensitivity: 'standard' },
      { code: 'RESP_RATE', name: 'Frecuencia respiratoria', unit: 'rpm', value_type: 'simple', components: [{ name: 'value', role: 'value', unit: 'rpm' }], sensitivity: 'standard' },
      { code: 'SPO2', name: 'Saturación de oxígeno', unit: '%', value_type: 'simple', components: [{ name: 'value', role: 'value', unit: '%' }], sensitivity: 'standard' },
    ],
  };
}

type Astro = Record<string, unknown>;

export function astronaut(callSign: string, level: string, extra: Astro = {}): Astro {
  return {
    astronaut_id: `id-${callSign}`,
    call_sign: callSign,
    crew_role: 'flight_engineer',
    worst_level: level,
    compliance: null,
    fitness: 'fit',
    indicators: [
      {
        code: 'RESP_RATE',
        level,
        last_value: { value: 31 },
        measured_at: '2026-11-14T07:50:00Z',
        trend: 'rising',
        series: [
          { measured_at: '2026-11-14T06:50:00Z', value: 18 },
          { measured_at: '2026-11-14T07:50:00Z', value: 31 },
        ],
      },
    ],
    ...extra,
  };
}

export function dashboard(astronauts: Astro[]) {
  return { mission_id: MISSION.id, mission_code: 'ARES-1', generated_at: '2026-11-14T08:15:00Z', astronauts };
}

export function inboxItem(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    mission_id: MISSION.id,
    mission_code: 'ARES-1',
    astronaut_id: 'id-ORION',
    call_sign: 'ORION',
    category: 'reading',
    source_type: 'reading',
    level: 'flight_surgeon',
    priority: 'routine',
    status: 'delivered',
    reason: `Motivo ${id}`,
    created_at: '2026-11-14T07:30:04Z',
    deliver_at: '2026-11-14T07:31:34Z',
    acknowledged_at: null,
    acknowledged_by: null,
    ...extra,
  };
}
