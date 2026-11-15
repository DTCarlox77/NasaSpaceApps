import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, NetworkError, request, SESSION_ENDED_MESSAGE } from '../api/http.ts';
import { shouldRetry } from '../api/queryClient.ts';
import { resolveApiBase } from '../config/env.ts';
import * as storage from '../auth/storage.ts';
import { apiError, groundContext, json, mockFetch, sleep, user } from './helpers.ts';

beforeEach(() => {
  storage.clearSession();
  storage.saveSession(
    { refresh_token: 'rt_old', user: user('flight_surgeon'), context: groundContext() },
    'at_old',
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  storage.clearSession();
});

describe('cliente HTTP: refresh rotativo', () => {
  it('3 peticiones con 401 → 1 solo /auth/refresh, 3 reintentos y los dos tokens nuevos', async () => {
    const { calls } = mockFetch(async (call) => {
      if (call.path === '/auth/refresh') {
        await sleep(20); // las tres esperan el mismo refresh
        return json(200, {
          access_token: 'at_new',
          token_type: 'Bearer',
          expires_in: 900,
          refresh_token: 'rt_new',
        });
      }
      if (call.auth === 'Bearer at_old') return apiError(401, 'UNAUTHENTICATED');
      return json(200, { path: call.path });
    });

    const results = await Promise.all([
      request<{ path: string }>('/admin/inbox'),
      request<{ path: string }>('/admin/dashboard/crew'),
      request<{ path: string }>('/admin/emergencies'),
    ]);

    expect(results.map((r) => r.path)).toEqual([
      '/admin/inbox',
      '/admin/dashboard/crew',
      '/admin/emergencies',
    ]);
    const refreshes = calls.filter((c) => c.path === '/auth/refresh');
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]?.body).toEqual({
      refresh_token: 'rt_old',
      device_id: storage.getDeviceId(),
    });
    const retries = calls.filter((c) => c.path !== '/auth/refresh' && c.auth === 'Bearer at_new');
    expect(retries).toHaveLength(3);
    expect(storage.getAccessToken()).toBe('at_new');
    expect(storage.getRefreshToken()).toBe('rt_new');
    // El refresh rotativo también queda en sessionStorage (sobrevive a recargar).
    expect(JSON.parse(sessionStorage.getItem('astro-panel.session') ?? '{}').refresh_token).toBe(
      'rt_new',
    );
  });

  it('TOKEN_REUSE_DETECTED en el refresh → cierra la sesión y avisa', async () => {
    mockFetch((call) =>
      call.path === '/auth/refresh'
        ? apiError(401, 'TOKEN_REUSE_DETECTED', 'Reuso', { family_revoked: true })
        : apiError(401, 'UNAUTHENTICATED'),
    );
    const ended = vi.fn();
    const unsubscribe = storage.onSessionEnded(ended);

    const error = await request('/admin/inbox').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).code).toBe('SESSION_ENDED');
    expect((error as HttpError).message).toBe(SESSION_ENDED_MESSAGE);
    expect(ended).toHaveBeenCalledWith('expired');
    expect(storage.loadSession()).toBeNull();
    expect(storage.getAccessToken()).toBeNull();
    expect(storage.getDeviceId()).toMatch(/^panel-/); // el dispositivo sobrevive
    unsubscribe();
  });

  it('error de red: NetworkError y la sesión NO se cierra (ni en el refresh)', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const ended = vi.fn();
    const unsubscribe = storage.onSessionEnded(ended);
    await expect(request('/admin/inbox')).rejects.toBeInstanceOf(NetworkError);
    expect(storage.getRefreshToken()).toBe('rt_old');

    // 401, y el refresh no llega a la red.
    mockFetch((call) =>
      call.path === '/auth/refresh'
        ? Promise.reject(new TypeError('Failed to fetch'))
        : apiError(401, 'UNAUTHENTICATED'),
    );
    await expect(request('/admin/inbox')).rejects.toBeInstanceOf(NetworkError);
    expect(storage.getRefreshToken()).toBe('rt_old');
    expect(ended).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('timeout: NetworkError con timeout = true', async () => {
    // fetch que nunca responde, salvo que se aborte.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    const error = await request('/health', { auth: false, timeoutMs: 20 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).timeout).toBe(true);
  });
});

describe('cliente HTTP: errores del contrato', () => {
  it('HttpError conserva status, code y details', async () => {
    mockFetch(() =>
      apiError(423, 'ACCOUNT_LOCKED', 'Cuenta bloqueada', { locked_until: '2026-11-14T08:30:00Z' }),
    );
    const error = (await request('/auth/login', { method: 'POST', auth: false, body: {} }).catch(
      (e: unknown) => e,
    )) as HttpError;
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(423);
    expect(error.code).toBe('ACCOUNT_LOCKED');
    expect(error.details).toEqual({ locked_until: '2026-11-14T08:30:00Z' });
  });

  it('403 es un HttpError normal (no refresca ni cierra sesión)', async () => {
    const { calls } = mockFetch(() => apiError(403, 'FORBIDDEN', 'Sin permiso', { required_roles: ['admin'] }));
    const error = (await request('/admin/compliance').catch((e: unknown) => e)) as HttpError;
    expect(error.status).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
    expect(calls.some((c) => c.path === '/auth/refresh')).toBe(false);
    expect(storage.getRefreshToken()).toBe('rt_old');
  });

  it('una respuesta sin el formato de error (503 de /health) → HTTP_503 con el cuerpo', async () => {
    mockFetch(() => json(503, { status: 'error', db: 'down' }));
    const error = (await request('/health', { auth: false }).catch((e: unknown) => e)) as HttpError;
    expect(error.code).toBe('HTTP_503');
    expect(error.details).toEqual({ status: 'error', db: 'down' });
  });

  it('manda Bearer, JSON y la URL con /api/v1', async () => {
    const { calls } = mockFetch(() => json(200, { ok: true }));
    await request('/admin/inbox', { method: 'POST', body: { a: 1 } });
    expect(calls[0]).toMatchObject({ path: '/admin/inbox', method: 'POST', auth: 'Bearer at_old', body: { a: 1 } });
  });

  it('React Query no reintenta 401/403/404; la red, hasta 2 veces', () => {
    for (const status of [401, 403, 404]) {
      expect(shouldRetry(0, new HttpError(status, 'X', 'x'))).toBe(false);
    }
    expect(shouldRetry(0, new NetworkError('x'))).toBe(true);
    expect(shouldRetry(1, new NetworkError('x'))).toBe(true);
    expect(shouldRetry(2, new NetworkError('x'))).toBe(false);
  });
});

describe('configuración', () => {
  it('VITE_API_URL: quita la "/" final y agrega /api/v1; error claro si falta', () => {
    expect(resolveApiBase('https://astro-health-api-81jd.onrender.com/')).toBe(
      'https://astro-health-api-81jd.onrender.com/api/v1',
    );
    expect(resolveApiBase('http://localhost:3000')).toBe('http://localhost:3000/api/v1');
    expect(() => resolveApiBase(undefined)).toThrow(/Falta VITE_API_URL/);
    expect(() => resolveApiBase('http://localhost:3000/api/v1')).toThrow(/sin \/api\/v1/);
  });

  it('device_id: panel-<uuid>, uno solo y sobrevive al logout', () => {
    const id = storage.getDeviceId();
    expect(id).toMatch(/^panel-[0-9a-f-]{36}$/);
    storage.clearSession();
    expect(storage.getDeviceId()).toBe(id);
  });
});
