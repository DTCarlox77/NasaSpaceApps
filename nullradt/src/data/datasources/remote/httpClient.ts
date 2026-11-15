import { env } from '@/core/config/env';
import { sessionSecureDataSource } from '../local/sessionSecureDataSource';

export class HttpError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/**
 * Petición JSON con timeout y token de sesión (Authorization: Bearer) si existe.
 * Lanza HttpError si no hay API configurada, hay timeout o la respuesta no es 2xx.
 */
async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T | null> {
  if (!env.apiUrl) throw new HttpError('API_URL not configured');

  const session = await sessionSecureDataSource.load();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session && !session.demo) headers.Authorization = `Bearer ${session.token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.apiTimeoutMs);
  try {
    const res = await fetch(`${env.apiUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status);
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(controller.signal.aborted ? 'timeout' : 'network error');
  } finally {
    clearTimeout(timer);
  }
}

export const getJson = <T>(path: string) => request<T>('GET', path);
export const postJson = <T>(path: string, body: unknown) => request<T>('POST', path, body);
