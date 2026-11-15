/**
 * Panel de Tierra (flight_surgeon y admin).
 * - GET /admin/dashboard/crew?mission_id=        x-roles: flight_surgeon, admin
 * - GET /indicators?sensitivity=standard          x-roles: astronaut, flight_surgeon, behavioral_health, admin
 *   (solo nombres y unidades; el panel pide únicamente los indicadores estándar).
 */
import { request } from './http.ts';
import { withQuery } from './params.ts';
import type { CrewDashboard, IndicatorList } from './types.ts';

export function getCrewDashboard(missionId: string, signal?: AbortSignal): Promise<CrewDashboard> {
  return request<CrewDashboard>(withQuery('/admin/dashboard/crew', { mission_id: missionId }), {
    signal,
  });
}

export function getIndicatorCatalog(signal?: AbortSignal): Promise<IndicatorList> {
  return request<IndicatorList>(withQuery('/indicators', { sensitivity: 'standard' }), { signal });
}
