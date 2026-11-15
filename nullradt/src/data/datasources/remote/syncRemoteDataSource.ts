import type { ApiSyncPullResponse, ApiSyncPushResponse } from './apiTypes';
import { getJson, HttpError, postJson } from './httpClient';

/** Máximo de items por lote (SYNC_MAX_BATCH; más → 413 PAYLOAD_TOO_LARGE). */
export const SYNC_MAX_BATCH = 500;

/**
 * Sincronización (guía §3):
 *   POST /sync/push { device_id, sent_at, items[] } → results en el mismo orden que items
 *   GET  /sync/pull?cursor=&limit= → evaluations, escalations, messages (+ estado de misión y enlace)
 */
export const syncRemoteDataSource = {
  async push(body: { device_id: string; sent_at: string; items: unknown[] }): Promise<ApiSyncPushResponse> {
    // Lotes grandes: más margen que el timeout normal.
    const res = await postJson<ApiSyncPushResponse>('/sync/push', body, { timeoutMs: 45000 });
    if (!res?.results) throw new HttpError('invalid response');
    return res;
  },
  async pull(cursor: string | null, limit = 100): Promise<ApiSyncPullResponse> {
    const q = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await getJson<ApiSyncPullResponse>(`/sync/pull?${q}`, { timeoutMs: 30000 });
    if (!res?.cursor) throw new HttpError('invalid response');
    return res;
  },
};
