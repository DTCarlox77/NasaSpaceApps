import type { ApiSessionWithRoster } from './apiTypes';
import { getJson, HttpError, postJson } from './httpClient';

/**
 * Emergencia (guía §10). `POST /alerts` NO existe en el contrato: se usa
 *   POST /emergency/sessions { client_uuid, trigger_type, started_at, responder_safe }
 *     → 201 (o 200 duplicado). Si ya había una abierta, `joined: true` (unirse, no abrir otra).
 *   GET  /emergency/sessions/{id}
 *   POST /emergency/sessions/{id}/confirm { confirmed_at }   ("Estoy bien"; 409 DEADMAN_EXPIRED tarde)
 *   POST /emergency/sessions/{id}/close { closed_at, status } (solo comandante u oficial médico)
 */
export const emergencyRemoteDataSource = {
  async openSession(body: Record<string, unknown>): Promise<ApiSessionWithRoster> {
    const res = await postJson<ApiSessionWithRoster>('/emergency/sessions', body);
    if (!res?.session) throw new HttpError('invalid response');
    return res;
  },
  async getSession(id: string): Promise<ApiSessionWithRoster> {
    const res = await getJson<ApiSessionWithRoster>(`/emergency/sessions/${encodeURIComponent(id)}`);
    if (!res?.session) throw new HttpError('invalid response');
    return res;
  },
  confirm: (id: string, body: Record<string, unknown>) => postJson<unknown>(`/emergency/sessions/${encodeURIComponent(id)}/confirm`, body),
  close: (id: string, body: Record<string, unknown>) => postJson<unknown>(`/emergency/sessions/${encodeURIComponent(id)}/close`, body),
};
