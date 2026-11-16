import { env } from '@/core/config/env';
import { sessionSecureDataSource } from '../local/sessionSecureDataSource';

/**
 * Cliente HTTP de la API (contrato v1.6, `backend/docs/openapi.yaml`).
 * - Base: EXPO_PUBLIC_API_URL + `/api/v1`. Timeout normal 15 s; GET /health al abrir, 60 s (Render se duerme).
 * - Bearer con el access token. Ante 401 UNAUTHENTICATED: UN refresh (POST /auth/refresh con el
 *   refresh token y el device_id), guarda LOS DOS tokens nuevos (refresh rotativo) y reintenta una vez.
 *   Refresh fallido o 401 TOKEN_REUSE_DETECTED → se cierra la sesión (`onSessionExpired`).
 * - Errores `{ error: { code, message, details } }`: se programa contra `code` (ver `HttpError`).
 */

export const API_PREFIX = '/api/v1';

/**
 * Error de la API o de red.
 * - `status` undefined = no hubo respuesta (sin red, timeout o API sin configurar).
 * - `code` = `error.code` del contrato (VALIDATION_ERROR, ACCOUNT_LOCKED…).
 */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly details?: unknown,
    readonly retryAfterSeconds?: number | null,
  ) {
    super(message);
  }

  /** Sin respuesta del servidor: conviene encolar y reintentar luego. */
  get isNetwork() {
    return this.status === undefined;
  }

  /** Vale la pena reintentar el mismo envío más tarde (sin red, 5xx o 429). */
  get isRetryable() {
    return this.status === undefined || this.status >= 500 || this.status === 429;
  }
}

type Method = 'GET' | 'POST' | 'PUT';

export interface RequestOptions {
  body?: unknown;
  /** false = sin Authorization (login, refresh, health). */
  auth?: boolean;
  /** Token Bearer explícito (p. ej. `password_change_token` del 428). */
  bearer?: string;
  timeoutMs?: number;
  /** Interno: evita refrescar dos veces. */
  retried?: boolean;
}

/** Lo registra la capa de presentación: cierra la sesión cuando el refresh ya no sirve. */
let sessionExpiredHandler: ((reason: 'expired' | 'reuse') => void) | null = null;
export function onSessionExpired(handler: (reason: 'expired' | 'reuse') => void) {
  sessionExpiredHandler = handler;
}

let refreshing: Promise<boolean> | null = null;

/** Refresh rotativo, una sola vez aunque varias peticiones reciban 401 al mismo tiempo. */
function refreshTokens(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const tokens = await sessionSecureDataSource.getTokens();
      if (!tokens) return false;
      try {
        const deviceId = await sessionSecureDataSource.getDeviceId();
        const res = await rawRequest<{ access_token: string; refresh_token: string }>('POST', '/auth/refresh', {
          body: { refresh_token: tokens.refreshToken, device_id: deviceId },
          auth: false,
        });
        if (!res?.access_token || !res.refresh_token) throw new HttpError('invalid refresh response');
        await sessionSecureDataSource.setTokens({ accessToken: res.access_token, refreshToken: res.refresh_token });
        return true;
      } catch (e) {
        // Sin red no se cierra la sesión: se reintenta cuando vuelva el enlace.
        if (e instanceof HttpError && e.isNetwork) throw e;
        await sessionSecureDataSource.clearTokens().catch(() => {});
        sessionExpiredHandler?.(e instanceof HttpError && e.code === 'TOKEN_REUSE_DETECTED' ? 'reuse' : 'expired');
        return false;
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function rawRequest<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T | null> {
  if (!env.apiUrl) throw new HttpError('API_URL not configured');
  const { body, auth = true, bearer, timeoutMs = env.apiTimeoutMs } = opts;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  else if (auth) {
    const tokens = await sessionSecureDataSource.getTokens();
    if (tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${API_PREFIX}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new HttpError(controller.signal.aborted ? 'timeout' : 'network error');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text().catch(() => '');
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    const retryAfter = Number(res.headers.get('Retry-After'));
    throw new HttpError(err?.message ?? `HTTP ${res.status}`, res.status, err?.code, err?.details, Number.isFinite(retryAfter) ? retryAfter : null);
  }
  return json as T | null;
}

/** Petición con Bearer y refresh automático ante 401 UNAUTHENTICATED. */
export async function apiRequest<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T | null> {
  try {
    return await rawRequest<T>(method, path, opts);
  } catch (e) {
    const canRefresh = opts.auth !== false && !opts.bearer && !opts.retried;
    if (canRefresh && e instanceof HttpError && e.status === 401 && (e.code === 'UNAUTHENTICATED' || !e.code)) {
      if (await refreshTokens()) return rawRequest<T>(method, path, { ...opts, retried: true });
    }
    throw e;
  }
}

export const getJson = <T>(path: string, opts?: Omit<RequestOptions, 'body'>) => apiRequest<T>('GET', path, opts);
export const postJson = <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) =>
  apiRequest<T>('POST', path, { ...opts, body });
export const putJson = <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) =>
  apiRequest<T>('PUT', path, { ...opts, body });

/** GET /api/v1/health con timeout largo (despierta Render). */
export async function wakeServer(): Promise<boolean> {
  try {
    const res = await rawRequest<{ status: string }>('GET', '/health', { auth: false, timeoutMs: env.apiWakeTimeoutMs });
    return res?.status === 'ok';
  } catch {
    return false;
  }
}
