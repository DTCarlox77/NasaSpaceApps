/**
 * Misión seleccionada del panel: una de `context.ground_missions` (la elegida queda en
 * sessionStorage; por defecto, la primera activa). Toda consulta de datos usa `missionId` en la
 * URL y en la query key (api/queryKeys.ts); sin misión, las consultas no se lanzan.
 */
import { useAuth } from '../auth/context.ts';
import type { MissionRef } from '../api/types.ts';

export interface MissionSelection {
  missionId: string | null;
  mission: MissionRef | null;
  missions: MissionRef[];
  selectMission(id: string): void;
}

export function useMission(): MissionSelection {
  const auth = useAuth();
  return {
    missionId: auth.mission?.id ?? null,
    mission: auth.mission,
    missions: auth.context?.ground_missions ?? [],
    selectMission: auth.selectMission,
  };
}
