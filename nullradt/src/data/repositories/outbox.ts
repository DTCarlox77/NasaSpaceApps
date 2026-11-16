import { apiEnabled } from '@/core/config/env';
import type { Session } from '@/domain/entities/Session';
import type { SyncEntity, SyncPriority } from '@/domain/entities/Sync';
import { outboxLocalDataSource } from '../datasources/local/outboxLocalDataSource';
import { sessionSecureDataSource } from '../datasources/local/sessionSecureDataSource';
import { HttpError } from '../datasources/remote/httpClient';

/** Dueño comodín: registros creados sin sesión (p. ej. SOS desde el login); los sube la próxima sesión. */
export const ANY_OWNER = '*';

/** Sesión con servidor (no demo). null = modo demo o sin login. */
export async function serverSession(): Promise<Session | null> {
  if (!apiEnabled()) return null;
  const s = await sessionSecureDataSource.load();
  return s && !s.demo ? s : null;
}

export type SendOrQueue<T> = { kind: 'sent'; value: T } | { kind: 'queued' };

/**
 * Patrón offline-first de la guía §3: intenta el endpoint en línea; si no hay red (o 5xx / 429),
 * guarda el MISMO body (sin client_uuid) en la cola con su `client_uuid` para reintentarlo en el push.
 * Los errores 4xx (datos inválidos, permisos) se propagan: reintentarlos igual no sirve.
 */
export async function sendOrQueue<T>(opts: {
  clientUuid: string;
  entity: SyncEntity;
  priority?: SyncPriority;
  ownerId: string;
  payload: Record<string, unknown>;
  send: () => Promise<T>;
  /** true = encolar ante cualquier error (emergencias: nunca se pierden). */
  queueOnAnyError?: boolean;
}): Promise<SendOrQueue<T>> {
  try {
    return { kind: 'sent', value: await opts.send() };
  } catch (e) {
    const retryable = e instanceof HttpError ? e.isRetryable : true;
    if (!retryable && !opts.queueOnAnyError) throw e;
    await outboxLocalDataSource.add({
      clientUuid: opts.clientUuid,
      entity: opts.entity,
      priority: opts.priority ?? 'normal',
      createdAt: new Date().toISOString(),
      payload: opts.payload,
      ownerId: opts.ownerId,
      attempts: 1,
      lastError: e instanceof Error ? e.message : 'unknown',
    });
    return { kind: 'queued' };
  }
}
