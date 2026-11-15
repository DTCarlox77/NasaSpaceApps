import type { ApiBodyStatus, ApiIndicatorList, ApiReadingCreated, ApiReadingPage } from './apiTypes';
import { getJson, HttpError, postJson } from './httpClient';

/**
 * Contrato (OpenAPI v1.6). `GET /health/indicators` NO existe: el estado sale de
 *   GET /me/body-status       → semáforo por zona (peor nivel) con último valor y recomendación
 *   GET /indicators           → catálogo: nombres, unidades, componentes, input_methods y fuentes
 *   GET /me/readings?code=    → serie para la tendencia
 *   POST /readings            → guarda y evalúa (201; 200 si es duplicado por client_uuid)
 */
export const healthRemoteDataSource = {
  async getBodyStatus(): Promise<ApiBodyStatus> {
    const res = await getJson<ApiBodyStatus>('/me/body-status');
    if (!res?.zones) throw new HttpError('invalid response');
    return res;
  },
  async getCatalog(): Promise<ApiIndicatorList> {
    const res = await getJson<ApiIndicatorList>('/indicators');
    if (!res?.items) throw new HttpError('invalid response');
    return res;
  },
  /** Lecturas de un indicador desde `from` (orden ascendente por measured_at). */
  async getReadings(code: string, fromIso: string, limit = 200): Promise<ApiReadingPage> {
    const q = `code=${encodeURIComponent(code)}&from=${encodeURIComponent(fromIso)}&limit=${limit}`;
    const res = await getJson<ApiReadingPage>(`/me/readings?${q}`);
    return res ?? { items: [], next_cursor: null };
  },
  async createReading(body: Record<string, unknown>): Promise<ApiReadingCreated> {
    const res = await postJson<ApiReadingCreated>('/readings', body);
    if (!res?.evaluation) throw new HttpError('invalid response');
    return res;
  },
};
