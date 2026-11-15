/**
 * Datos del dashboard: GET /admin/dashboard/crew?mission_id= cada 30 s y el catálogo estándar
 * de indicadores (nombres y unidades; una vez por sesión). Lo que el rol no debe ver se filtra
 * en screenDashboard().
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCrewDashboard, getIndicatorCatalog } from '../../api/ground.ts';
import { queryKeys } from '../../api/queryKeys.ts';
import { useAuth } from '../../auth/context.ts';
import { useMission } from '../../mission/useMission.ts';
import { catalogMap, screenDashboard } from './crew.ts';

export const DASHBOARD_POLL_MS = 30_000;

export function useCrewDashboard() {
  const { missionId, mission } = useMission();
  const { role } = useAuth();

  const query = useQuery({
    queryKey: queryKeys.crewDashboard(missionId ?? ''),
    queryFn: ({ signal }) => getCrewDashboard(missionId as string, signal),
    enabled: !!missionId,
    refetchInterval: DASHBOARD_POLL_MS,
  });

  const catalogQuery = useQuery({
    queryKey: queryKeys.indicatorCatalog(),
    queryFn: ({ signal }) => getIndicatorCatalog(signal),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const catalog = useMemo(
    () => catalogMap(Array.isArray(catalogQuery.data?.items) ? catalogQuery.data.items : undefined),
    [catalogQuery.data],
  );

  const screened = useMemo(
    () =>
      query.data && Array.isArray(query.data.astronauts)
        ? screenDashboard(query.data, role, catalog)
        : null,
    [query.data, role, catalog],
  );

  return {
    missionId,
    mission,
    query,
    catalog,
    /** El catálogo ya respondió (bien o mal): hasta entonces no se pintan indicadores. */
    catalogSettled: !catalogQuery.isPending,
    screened,
  };
}
