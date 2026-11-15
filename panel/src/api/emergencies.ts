/**
 * Emergencias en Tierra (triaje autónomo a bordo).
 * - GET /admin/emergencies?mission_id=&status=&cursor=&limit=   x-roles: flight_surgeon, admin
 * - GET /admin/emergencies/{id}                                  x-roles: flight_surgeon, admin
 * Para admin la API manda solo el estado operativo (`counts` null; sin respuestas, categorías,
 * preguntas, orden de atención ni reporte). El acuse y la respuesta van por /admin/escalations.
 */
import { request } from './http.ts';
import { withQuery } from './params.ts';
import type { EmergencyDetail, EmergencyListPage } from './types.ts';

/** Filtro de estado del contrato (status de GET /admin/emergencies). */
export type EmergencyFilter = 'pending' | 'active' | 'closed' | 'cancelled';

export function getEmergencies(
  missionId: string,
  status?: EmergencyFilter,
  cursor?: string,
  limit = 25,
  signal?: AbortSignal,
): Promise<EmergencyListPage> {
  return request<EmergencyListPage>(
    withQuery('/admin/emergencies', { mission_id: missionId, status, cursor, limit }),
    { signal },
  );
}

export function getEmergency(id: string, signal?: AbortSignal): Promise<EmergencyDetail> {
  return request<EmergencyDetail>(`/admin/emergencies/${encodeURIComponent(id)}`, { signal });
}
