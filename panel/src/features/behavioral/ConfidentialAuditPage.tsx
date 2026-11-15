/**
 * Salud conductual · Auditoría de accesos confidenciales (/salud-conductual/auditoria), SOLO
 * behavioral_health. GET /admin/audit/confidential-access?mission_id= cada 30 s: quién consultó
 * datos de bienestar, de quién, qué y cuándo (sin el contenido ni la IP). Más reciente primero.
 */
import type { ReactNode } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getConfidentialAccess } from '../../api/behavioral.ts';
import { queryKeys } from '../../api/queryKeys.ts';
import type { ConfidentialAccess } from '../../api/types.ts';
import { Banner } from '../../components/Banner.tsx';
import { Button } from '../../components/Button.tsx';
import { Loading, QueryError, UpdatedAgo } from '../../components/QueryStatus.tsx';
import { dateClock, timeAgo } from '../../lib/time.ts';
import { useNow } from '../../lib/useNow.ts';
import { useMission } from '../../mission/useMission.ts';
import { RoleBadge } from '../../components/RoleBadge.tsx';
import { AUDIT_POLL_MS } from './behavioral.ts';
import { BehavioralTabs, ConfidentialNote } from './common.tsx';
import './behavioral.css';

const RESOURCES: Record<string, string> = {
  'GET /api/v1/admin/behavioral/inbox': 'Bandeja confidencial',
  'GET /api/v1/admin/behavioral/astronauts/{id}': 'Detalle confidencial',
};

const itemsOf = (page: { items?: unknown } | undefined): ConfidentialAccess[] =>
  Array.isArray(page?.items) ? (page.items as ConfidentialAccess[]) : [];

export function ConfidentialAuditPage() {
  const { missionId, mission } = useMission();
  const now = useNow(AUDIT_POLL_MS);
  const query = useInfiniteQuery({
    queryKey: queryKeys.confidentialAccess(missionId ?? ''),
    queryFn: ({ pageParam, signal }) => getConfidentialAccess(missionId as string, pageParam, 50, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last?.next_cursor ?? undefined,
    enabled: !!missionId,
    refetchInterval: AUDIT_POLL_MS,
  });
  const items = (query.data?.pages ?? []).flatMap(itemsOf);

  let body: ReactNode;
  if (!missionId) {
    body = <Banner tone="info">No tienes una misión asignada.</Banner>;
  } else if (!query.data) {
    body = query.isError ? (
      <QueryError error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <Loading label="Cargando la auditoría…" />
    );
  } else if (items.length === 0) {
    body = <p className="muted">Nadie consultó datos confidenciales todavía.</p>;
  } else {
    body = (
      <>
        <table className="data-table audit-table">
          <caption className="visually-hidden">Accesos a datos confidenciales</caption>
          <thead>
            <tr>
              <th scope="col">Quién</th>
              <th scope="col">De quién</th>
              <th scope="col">Qué consultó</th>
              <th scope="col">Cuándo</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td>
                  <strong>{a.actor_username ?? a.actor_user_id}</strong>
                  <br />
                  <RoleBadge role={a.actor_role} plain />
                </td>
                <td>{a.call_sign ?? a.astronaut_id}</td>
                <td>
                  {RESOURCES[a.resource] ?? 'Datos de bienestar'}
                  <br />
                  <code className="muted small">{a.resource}</code>
                </td>
                <td>
                  {dateClock(a.accessed_at)}
                  <br />
                  <span className="muted small">{timeAgo(a.accessed_at, now)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {query.hasNextPage ? (
          <div>
            <Button variant="secondary" onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
              Cargar más
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <section className="page page-wide stack" aria-labelledby="audit-title">
      <div className="page-header">
        <div>
          <p className="eyebrow">Misión {mission?.code ?? '—'}</p>
          <h1 id="audit-title">Auditoría de accesos confidenciales</h1>
          <ConfidentialNote />
        </div>
        {query.data ? (
          <p className="muted page-header-meta">
            <UpdatedAgo
              updatedAt={query.dataUpdatedAt}
              now={now}
              failed={query.isError}
              fetching={query.isFetching && !query.isFetchingNextPage}
            />
            <br />
            Se actualiza cada 30 s
          </p>
        ) : null}
      </div>
      <BehavioralTabs />
      <p className="muted">
        Quién consultó datos de bienestar, de quién y cuándo (sin el contenido). Cada astronauta ve lo suyo en
        la app.
      </p>
      {body}
    </section>
  );
}
