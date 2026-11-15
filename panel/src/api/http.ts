/**
 * Cliente HTTP del panel.
 * - Prefija API_BASE, manda JSON y `Authorization: Bearer <access_token>`.
 * - Timeout con AbortController (20 s por defecto; configurable por llamada).
 * - El backend responde siempre { error: { code, message, details } } → HttpError. El código
 *   decide por `code`, nunca por el texto.
 * - 401 UNAUTHENTICATED → UN solo POST /auth/refresh aunque fallen varias peticiones a la vez
 *   (promesa compartida), guarda los DOS tokens (rotativo) y reintenta una vez la original.
 *   Si el refresh responde 401 (TOKEN_REUSE_DETECTED u otro) → fin de sesión.
 * - Red caída o timeout → NetworkError: NO cierra la sesión.
 * - VITE_DATA_MODE=mock: no sale a la red. `transport()` delega en el adaptador de src/api/mock/,
 *   que responde por método + ruta del contrato con un Response igual al del backend; el resto
 *   (errores, refresh, timeout) es el mismo código en los dos modos.
 */
import { apiBase, isMockMode } from '../config/env.ts';
import * as storage from '../auth/storage.ts';
import type { ErrorBody, TokenPair } from './types.ts';

export const SESSION_ENDED_MESSAGE = 'Tu sesión terminó. Inicia sesión de nuevo.';
export const DEFAULT_TIMEOUT_MS = 20_000;

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class NetworkError extends Error {
  readonly timeout: boolean;

  constructor(message: string, { timeout = false, cause }: { timeout?: boolean; cause?: unknown } = {}) {
    super(message, { cause });
    this.name = 'NetworkError';
    this.timeout = timeout;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Manda el access token y refresca ante un 401 (por defecto true). */
  auth?: boolean;
  /** Bearer explícito (p. ej. el password_change_token del 428); no refresca. */
  token?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function isErrorBody(value: unknown): value is { error: ErrorBody } {
  if (!value || typeof value !== 'object' || !('error' in value)) return false;
  const error = (value as { error: unknown }).error;
  return !!error && typeof error === 'object' && typeof (error as ErrorBody).code === 'string';
}

interface TransportInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}

/** La red, o el adaptador del modo demo (cargado aparte: no pesa en el modo api). */
async function transport(path: string, init: TransportInit): Promise<Response> {
  if (isMockMode()) {
    const { mockTransport } = await import('./mock/server.ts');
    return mockTransport(path, init);
  }
  return fetch(`${apiBase()}${path}`, init);
}

async function send(path: string, options: RequestOptions, bearer: string | null): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  try {
    return await transport(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (err) {
    if (timedOut) {
      throw new NetworkError(`El servidor no respondió en ${Math.round(timeoutMs / 1000)} s.`, {
        timeout: true,
        cause: err,
      });
    }
    if (options.signal?.aborted) throw err;
    throw new NetworkError('No se pudo conectar con el servidor.', { cause: err });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (response.ok) return data as T;
  if (isErrorBody(data)) {
    throw new HttpError(response.status, data.error.code, data.error.message, data.error.details ?? null);
  }
  throw new HttpError(response.status, `HTTP_${response.status}`, `El servidor respondió ${response.status}.`, data ?? null);
}

// ---------------------------------------------------------------- refresh compartido

let inflightRefresh: Promise<string> | null = null;

/**
 * Pide un access token nuevo con el refresh token. Si ya hay un refresh en curso, devuelve la
 * misma promesa. Guarda los dos tokens nuevos. Si el backend lo rechaza (401 u otro 4xx que no
 * sea 429), termina la sesión; un error de red no la termina.
 */
export function refreshAccessToken(): Promise<string> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    const refreshToken = storage.getRefreshToken();
    if (!refreshToken) {
      storage.endSession('expired');
      throw new HttpError(401, 'SESSION_ENDED', SESSION_ENDED_MESSAGE);
    }
    try {
      const response = await send(
        '/auth/refresh',
        { method: 'POST', body: { refresh_token: refreshToken, device_id: storage.getDeviceId() } },
        null,
      );
      const tokens = await parse<TokenPair>(response);
      storage.setTokens(tokens.access_token, tokens.refresh_token);
      return tokens.access_token;
    } catch (err) {
      if (err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        storage.endSession('expired');
        throw new HttpError(401, 'SESSION_ENDED', SESSION_ENDED_MESSAGE, { cause_code: err.code });
      }
      throw err;
    }
  })().finally(() => {
    inflightRefresh = null;
  });
  return inflightRefresh;
}

// ---------------------------------------------------------------- petición

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const useSession = options.auth !== false && options.token === undefined;
  const bearer = options.token ?? (useSession ? storage.getAccessToken() : null);
  try {
    return await parse<T>(await send(path, options, bearer));
  } catch (err) {
    const expired = err instanceof HttpError && err.status === 401 && err.code === 'UNAUTHENTICATED';
    if (!expired || !useSession) throw err;
    // Si otra petición ya refrescó mientras esta viajaba, basta con reintentar con el nuevo.
    const current = storage.getAccessToken();
    const fresh = current && current !== bearer ? current : await refreshAccessToken();
    return parse<T>(await send(path, options, fresh));
  }
}

/** Mensaje para el usuario según el tipo de error (el código manda, no el texto). */
export function describeError(err: unknown): string {
  if (err instanceof NetworkError) return 'No se pudo conectar con el servidor.';
  if (err instanceof HttpError) {
    if (err.code === 'SESSION_ENDED') return SESSION_ENDED_MESSAGE;
    if (err.status === 403) return 'Tu rol no tiene acceso a esta sección.';
    if (err.status === 404) return 'No se encontró lo que buscas.';
    if (err.status === 429) return 'Demasiadas peticiones. Espera unos segundos.';
    if (err.status >= 500) return 'El servidor tuvo un problema. Intenta de nuevo.';
    return err.message;
  }
  return 'Ocurrió un error inesperado.';
}
