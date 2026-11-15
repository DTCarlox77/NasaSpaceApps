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
