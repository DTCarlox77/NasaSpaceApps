import type { OutboxItem, PullSummary, PushSummary } from '../entities/Sync';

/** Sincronización offline-first (guía §3): subir la cola y bajar lo nuevo. */
export interface SyncRepository {
  /** POST /sync/push en lotes de ≤ 500, emergencias primero. Procesa `results` y limpia la cola. */
  push(ownerId: string): Promise<PushSummary>;
  /** GET /sync/pull con el cursor guardado (repite mientras `has_more`). null = sin conexión. */
  pull(ownerId: string): Promise<PullSummary | null>;
  pending(ownerId: string): Promise<OutboxItem[]>;
}
