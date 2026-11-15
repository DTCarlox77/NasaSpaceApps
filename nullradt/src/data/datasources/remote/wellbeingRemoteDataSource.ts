import type { ApiInstrument, ApiPvtResult, ApiSupportRequest, ApiWellbeingAck } from './apiTypes';
import { getJson, HttpError, postJson } from './httpClient';

/**
 * Bienestar confidencial (guía §11). Las respuestas son neutras: nunca traen color, nivel ni puntaje.
 *   POST /wellbeing/checkins · POST /wellbeing/support-requests · POST /wellbeing/pvt-runs
 *   GET /wellbeing/instruments?lang= · POST /wellbeing/screenings
 */
const required = <T>(res: T | null): T => {
  if (!res) throw new HttpError('empty response');
  return res;
};

export const wellbeingRemoteDataSource = {
  createCheckIn: async (body: Record<string, unknown>) => required(await postJson<ApiWellbeingAck>('/wellbeing/checkins', body)),
  createSupportRequest: async (body: Record<string, unknown>) =>
    required(await postJson<ApiSupportRequest>('/wellbeing/support-requests', body)),
  createPvtRun: async (body: Record<string, unknown>) => required(await postJson<ApiPvtResult>('/wellbeing/pvt-runs', body)),
  getInstruments: async (lang: 'es' | 'en') => (await getJson<{ items: ApiInstrument[] }>(`/wellbeing/instruments?lang=${lang}`))?.items ?? [],
  createScreening: async (body: Record<string, unknown>) => required(await postJson<ApiWellbeingAck>('/wellbeing/screenings', body)),
};
