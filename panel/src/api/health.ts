/** GET /health (público). En Render el plan gratuito se duerme: el primer pedido tarda ~50 s. */
import { request } from './http.ts';
import type { Health } from './types.ts';

export const WAKE_TIMEOUT_MS = 60_000;

export function getHealth(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Health> {
  return request<Health>('/health', {
    auth: false,
    timeoutMs: options.timeoutMs ?? WAKE_TIMEOUT_MS,
    signal: options.signal,
  });
}
