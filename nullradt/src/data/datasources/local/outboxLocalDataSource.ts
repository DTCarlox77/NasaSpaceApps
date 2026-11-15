import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OutboxItem } from '@/domain/entities/Sync';

/**
 * Cola local de sincronización (generaliza la antigua cola de informes `pendingReportsLocalDataSource`).
 * Sobrevive a reinicios. Cada item lleva su `client_uuid`, generado UNA vez al crearlo (idempotencia).
 * Se usa AsyncStorage (ya era la persistencia de la cola anterior); las escrituras se serializan
 * para que dos envíos simultáneos no se pisen.
 */
const KEY = 'nullradt-outbox-v1';

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

async function readAll(): Promise<OutboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

const writeAll = (items: OutboxItem[]) => AsyncStorage.setItem(KEY, JSON.stringify(items));

export const outboxLocalDataSource = {
  async forOwner(ownerId: string): Promise<OutboxItem[]> {
    return (await readAll()).filter((i) => i.ownerId === ownerId);
  },
  /** Agrega sin duplicar (mismo `client_uuid` = mismo registro). */
  add(item: OutboxItem): Promise<void> {
    return serialized(async () => {
      const all = await readAll();
      if (!all.some((i) => i.clientUuid === item.clientUuid)) all.push(item);
      await writeAll(all);
    });
  },
  remove(clientUuids: string[]): Promise<void> {
    if (!clientUuids.length) return Promise.resolve();
    const drop = new Set(clientUuids);
    return serialized(async () => writeAll((await readAll()).filter((i) => !drop.has(i.clientUuid))));
  },
  /** Marca un intento fallido (se conserva en la cola). */
  markFailed(clientUuids: string[], error: string): Promise<void> {
    if (!clientUuids.length) return Promise.resolve();
    const failed = new Set(clientUuids);
    return serialized(async () =>
      writeAll((await readAll()).map((i) => (failed.has(i.clientUuid) ? { ...i, attempts: i.attempts + 1, lastError: error } : i))),
    );
  },
};
