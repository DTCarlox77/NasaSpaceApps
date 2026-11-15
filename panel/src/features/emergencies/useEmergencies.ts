/**
 * Datos de Emergencias con sondeo adaptable: cada 10 s si hay una emergencia abierta
 * (pending o active), cada 30 s si no.
 * - Lista: GET /admin/emergencies?mission_id=&status= con "Cargar más" (cursor).
 * - Aviso global de la cabecera: la primera página sin filtro.
 * - Detalle: GET /admin/emergencies/{id}.
 */
import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getEmergencies, getEmergency, type EmergencyFilter } from '../../api/emergencies.ts';
import { queryKeys } from '../../api/queryKeys.ts';
import type { EmergencyListItem } from '../../api/types.ts';
import { useMission } from '../../mission/useMission.ts';
import { anyOpen, isOpen, pollInterval } from './emergencies.ts';

const itemsOf = (page: { items?: unknown } | undefined): EmergencyListItem[] =>
  Array.isArray(page?.items) ? (page.items as EmergencyListItem[]) : [];

export function useEmergencyList(status?: EmergencyFilter) {
  const { missionId } = useMission();
  const query = useInfiniteQuery({
    queryKey: queryKeys.emergencies(missionId ?? '', status ?? 'all'),
    queryFn: ({ pageParam, signal }) => getEmergencies(missionId as string, status, pageParam, 25, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last?.next_cursor ?? undefined,
    enabled: !!missionId,
    refetchInterval: (q) => pollInterval(anyOpen(q.state.data?.pages.flatMap(itemsOf))),
  });
  const items = useMemo(() => {
    const byId = new Map<string, EmergencyListItem>();
    for (const page of query.data?.pages ?? []) for (const item of itemsOf(page)) byId.set(item.id, item);
    return [...byId.values()];
  }, [query.data]);
  return { missionId, query, items };
}

/** La emergencia abierta más reciente de la misión (o null). */
export function useOpenEmergency(enabled: boolean) {
  const { missionId } = useMission();
  const query = useQuery({
    queryKey: queryKeys.emergenciesOpen(missionId ?? ''),
    queryFn: ({ signal }) => getEmergencies(missionId as string, undefined, undefined, 50, signal),
    enabled: enabled && !!missionId,
    refetchInterval: (q) => pollInterval(anyOpen(itemsOf(q.state.data))),
  });
  const open = itemsOf(query.data)
    .filter((item) => isOpen(item.status))
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  return open[0] ?? null;
}

export function useEmergency(id: string) {
  const { missionId } = useMission();
  const query = useQuery({
    queryKey: queryKeys.emergency(missionId ?? '', id),
    queryFn: ({ signal }) => getEmergency(id, signal),
    enabled: !!missionId && !!id,
    refetchInterval: (q) => pollInterval(isOpen(q.state.data?.session?.status)),
  });
  return { missionId, query };
}
