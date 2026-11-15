/** GET /missions/current (x-roles: astronaut, flight_surgeon, behavioral_health, admin). */
import { request } from './http.ts';
import { withQuery } from './params.ts';
import type { CurrentMission } from './types.ts';

export function getCurrentMission(missionId: string, signal?: AbortSignal): Promise<CurrentMission> {
  return request<CurrentMission>(withQuery('/missions/current', { mission_id: missionId }), { signal });
}
