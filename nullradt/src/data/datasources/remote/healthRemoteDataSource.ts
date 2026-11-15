import type { HealthIndicator } from '@/domain/entities/HealthIndicator';
import { getJson, HttpError } from './httpClient';

/**
 * Contrato con el backend:
 *   GET /api/v1/health/indicators   (Authorization: Bearer <token>)
 *   200 → { indicators: HealthIndicator[] }   (ver src/domain/entities/HealthIndicator.ts)
 * El backend calcula `status` con reglas validadas y envía `range.source` con la cita de cada umbral.
 */
export const healthRemoteDataSource = {
  async getIndicators(): Promise<HealthIndicator[]> {
    const res = await getJson<{ indicators: HealthIndicator[] }>('/api/v1/health/indicators');
    if (!res?.indicators) throw new HttpError('invalid response');
    return res.indicators;
  },
};
