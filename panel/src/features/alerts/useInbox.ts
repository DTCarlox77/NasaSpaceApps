/**
 * Bandeja: GET /admin/inbox?mission_id=&category=&status=&cursor=&limit= cada 15 s, con
 * paginación por cursor ("Cargar más"). El contador de la barra lateral cuenta lo que está
 * "sin acuse" (status=delivered).
 */
import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { getInbox } from '../../api/ground.ts';
import { queryKeys, type InboxFilters } from '../../api/queryKeys.ts';
import { useMission } from '../../mission/useMission.ts';
import { mergePages } from './inbox.ts';

export const INBOX_POLL_MS = 15_000;
export const INBOX_PAGE_SIZE = 25;
/** Tope del contador: con más, la barra lateral muestra "50+". */
export const BADGE_LIMIT = 50;

export function useInbox(filters: InboxFilters) {
  const { missionId } = useMission();
  const query = useInfiniteQuery({
    queryKey: queryKeys.inbox(missionId ?? '', filters),
    queryFn: ({ pageParam, signal }) =>
      getInbox(missionId as string, filters, pageParam, INBOX_PAGE_SIZE, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last?.next_cursor ?? undefined,
    enabled: !!missionId,
    refetchInterval: INBOX_POLL_MS,
  });
  const items = useMemo(() => mergePages(query.data?.pages), [query.data]);
  return { missionId, query, items };
}

export function useUnacknowledgedCount(enabled: boolean) {
  const { missionId } = useMission();
  const query = useQuery({
    queryKey: queryKeys.inboxUnacknowledged(missionId ?? ''),
    queryFn: ({ signal }) =>
      getInbox(missionId as string, { status: 'delivered' }, undefined, BADGE_LIMIT, signal),
    enabled: enabled && !!missionId,
    refetchInterval: INBOX_POLL_MS,
  });
  const items = Array.isArray(query.data?.items) ? query.data.items : null;
  return items ? { count: items.length, more: !!query.data?.next_cursor } : null;
}
