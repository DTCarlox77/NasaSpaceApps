import type { EmergencyReport } from '@/domain/entities/EmergencyReport';
import { postJson } from './httpClient';

/**
 * Contrato con el backend (Node + Express):
 *   POST /api/v1/alerts
 *   Body: EmergencyReport (JSON)
 *   Respuesta esperada: 201/200. El `id` lo genera el cliente para que el
 *   reenvío desde la cola sea idempotente (el backend debe ignorar duplicados).
 */
export const alertsRemoteDataSource = {
  send: (report: EmergencyReport) => postJson<unknown>('/api/v1/alerts', report),
};
