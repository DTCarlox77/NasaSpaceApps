import type { ApiCrewPage, ApiCrewStatus, ApiCurrentMission } from './apiTypes';
import { getJson, HttpError } from './httpClient';

/**
 * Misión y tripulación:
 *   GET /missions/current        → misión vigente, entorno, crew_role y enlace
 *   GET /missions/{id}/crew      → roster (sin datos de salud)
 *   GET /crew/status             → salud de compañeros acordada con el backend (si aún no existe, 404)
 */
export const crewRemoteDataSource = {
  async currentMission(): Promise<ApiCurrentMission> {
    const res = await getJson<ApiCurrentMission>('/missions/current');
    if (!res?.mission) throw new HttpError('invalid response');
    return res;
  },
  async crew(missionId: string): Promise<ApiCrewPage['items']> {
    const items: ApiCrewPage['items'] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const q: string = cursor ? `?limit=200&cursor=${encodeURIComponent(cursor)}` : '?limit=200';
      const res: ApiCrewPage | null = await getJson<ApiCrewPage>(`/missions/${encodeURIComponent(missionId)}/crew${q}`);
      items.push(...(res?.items ?? []));
      cursor = res?.next_cursor ?? null;
      if (!cursor) break;
    }
    return items;
  },
  async crewStatus(): Promise<ApiCrewStatus> {
    const res = await getJson<ApiCrewStatus>('/crew/status');
    if (!res?.crew) throw new HttpError('invalid response');
    return res;
  },
};
