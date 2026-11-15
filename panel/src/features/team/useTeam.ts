/**
 * Datos de Equipo (solo admin):
 * - Tripulación: GET /missions/{id}/crew + GET /admin/assignments (contrato) y, solo en el modo
 *   demo, GET /admin/users?kind=crew para el usuario, el estado y el último acceso.
 * - Equipo en Tierra: solo en el modo demo (GET /admin/users?kind=ground); el contrato v1.8 no
 *   tiene una lista de cuentas.
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAssignments, getMissionCrew, getTeamAccounts } from '../../api/team.ts';
import { MISSION_DATA, queryKeys } from '../../api/queryKeys.ts';
import type { TeamAccount } from '../../api/types.ts';
import { isMockMode } from '../../config/env.ts';
import { useMission } from '../../mission/useMission.ts';
import { buildCrewRows } from './team.ts';

export const TEAM_POLL_MS = 30_000;

const listOf = <T,>(page: { items?: unknown } | null | undefined): T[] | null =>
  page && Array.isArray(page.items) ? (page.items as T[]) : null;

export function useCrewRoster() {
  const { missionId } = useMission();
  const mock = isMockMode();
  const crew = useQuery({
    queryKey: queryKeys.missionCrew(missionId ?? ''),
    queryFn: ({ signal }) => getMissionCrew(missionId as string, signal),
    enabled: !!missionId,
    refetchInterval: TEAM_POLL_MS,
  });
  const assignments = useQuery({
    queryKey: queryKeys.assignments(missionId ?? ''),
    queryFn: ({ signal }) => getAssignments(missionId as string, signal),
    enabled: !!missionId,
  });
  const accounts = useQuery({
    queryKey: queryKeys.teamAccounts(missionId ?? '', 'crew'),
    queryFn: ({ signal }) => getTeamAccounts('crew', signal),
    enabled: !!missionId && mock,
  });
  const rows = useMemo(
    () =>
      buildCrewRows(
        listOf(crew.data) ?? [],
        listOf(assignments.data),
        listOf<TeamAccount>(accounts.data),
      ),
    [crew.data, assignments.data, accounts.data],
  );
  return { missionId, crew, assignments, accounts, rows, mock };
}

export function useGroundAccounts() {
  const { missionId } = useMission();
  const mock = isMockMode();
  const query = useQuery({
    queryKey: queryKeys.teamAccounts(missionId ?? '', 'ground'),
    queryFn: ({ signal }) => getTeamAccounts('ground', signal),
    enabled: !!missionId && mock,
    refetchInterval: TEAM_POLL_MS,
  });
  return { query, accounts: listOf<TeamAccount>(query.data) ?? [], mock };
}

/** Tras un alta o una acción: todo lo de la misión (equipo, dashboard, cumplimiento…). */
export function useRefreshMission() {
  const queryClient = useQueryClient();
  const { missionId } = useMission();
  return () => queryClient.invalidateQueries({ queryKey: [MISSION_DATA, missionId ?? ''] });
}
