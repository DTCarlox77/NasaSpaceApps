/**
 * Salud conductual · Bandeja (/salud-conductual), SOLO behavioral_health.
 * GET /admin/behavioral/inbox?mission_id=&include_closed= cada 30 s: escalamientos
 * confidenciales y solicitudes "Quiero hablar con alguien" que ya llegaron a Tierra, en el orden
 * de la API (apoyo ahora, alertas urgentes, apoyo hoy, alertas de rutina, apoyo que puede esperar).
 * Cada consulta queda registrada en la auditoría de accesos.
 */
import type { ReactNode } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { getBehavioralInbox } from '../../api/behavioral.ts';
import { queryKeys } from '../../api/queryKeys.ts';
import type { BehavioralInboxItem } from '../../api/types.ts';
import { Banner } from '../../components/Banner.tsx';
import { Button } from '../../components/Button.tsx';
import { Loading, QueryError, UpdatedAgo } from '../../components/QueryStatus.tsx';
import { dayClock, timeAgo } from '../../lib/time.ts';
import { useNow } from '../../lib/useNow.ts';
import { useMission } from '../../mission/useMission.ts';
import { PriorityBadge } from '../alerts/PriorityBadge.tsx';
import {
  CHANNEL_LABELS,
  INBOX_POLL_MS,
  indicatorLabel,
  KIND_LABELS,
  STATUS_LABELS,
} from './behavioral.ts';
import { BehavioralTabs, ConfidentialNote, UrgencyBadge } from './common.tsx';
import './behavioral.css';

const itemsOf = (page: { items?: unknown } | undefined): BehavioralInboxItem[] =>
  Array.isArray(page?.items) ? (page.items as BehavioralInboxItem[]) : [];

function InboxRow({ item, now }: { item: BehavioralInboxItem; now: number }) {
  const support = item.kind === 'support_request';
  return (
    <li className={`bh-row bh-${item.kind}${item.status === 'closed' ? ' bh-closed' : ''}`}>
      <Link
        to={`/salud-conductual/astronauta/${encodeURIComponent(item.astronaut_id)}?item=${encodeURIComponent(item.id)}`}
        className="bh-link"
      >
        <span className="row">
          {support && item.urgency ? <UrgencyBadge urgency={item.urgency} /> : null}
          {!support && item.priority ? <PriorityBadge priority={item.priority} /> : null}
          <strong>{item.call_sign}</strong>
          <span className="tag">
            {KIND_LABELS[item.kind] ?? item.kind}
            {support && item.channel ? ` · ${CHANNEL_LABELS[item.channel]}` : ''}
            {!support && item.indicator_code ? ` · ${indicatorLabel(item.indicator_code)}` : ''}
          </span>
          <span className="tag">{STATUS_LABELS[item.status] ?? item.status}</span>
        </span>
        <span className="small">{item.summary}</span>
        <span className="muted small">
          {item.measured_at ? `registrado ${timeAgo(item.measured_at, now)} · ` : ''}
          {item.deliver_at ? `llegó a Tierra a las ${dayClock(item.deliver_at, now)}` : 'en camino a Tierra'}
        </span>
      </Link>
    </li>
  );
}

export function BehavioralInboxPage() {
  const { missionId, mission } = useMission();
  const [params, setParams] = useSearchParams();
  const includeClosed = params.get('cerradas') === '1';
  const now = useNow(INBOX_POLL_MS);
  const query = useInfiniteQuery({
    queryKey: queryKeys.behavioralInbox(missionId ?? '', includeClosed),
    queryFn: ({ pageParam, signal }) =>
      getBehavioralInbox(missionId as string, includeClosed, pageParam, 50, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last?.next_cursor ?? undefined,
    enabled: !!missionId,
    refetchInterval: INBOX_POLL_MS,
  });
  const items = (query.data?.pages ?? []).flatMap(itemsOf);

  function toggleClosed(checked: boolean) {
    const next = new URLSearchParams(params);
    if (checked) next.set('cerradas', '1');
    else next.delete('cerradas');
    setParams(next, { replace: true });
  }

  let list: ReactNode;
  if (!missionId) {
    list = <Banner tone="info">No tienes una misión asignada.</Banner>;
  } else if (!query.data) {
    list = query.isError ? (
      <QueryError error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <Loading label="Cargando la bandeja confidencial…" />
    );
  } else if (items.length === 0) {
    list = <p className="muted">No hay escalamientos ni solicitudes pendientes.</p>;
  } else {
    list = (
      <>
        <ul className="bh-list" aria-label="Bandeja confidencial">
          {items.map((item) => (
            <InboxRow key={item.id} item={item} now={now} />
          ))}
        </ul>
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
    <section className="page page-wide stack" aria-labelledby="bh-title">
      <div className="page-header">
        <div>
          <p className="eyebrow">Misión {mission?.code ?? '—'}</p>
          <h1 id="bh-title">Salud conductual</h1>
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
        Escalamientos confidenciales y solicitudes "Quiero hablar con alguien" que ya llegaron a Tierra, por
        prioridad y retraso. Abre una para ver el detalle de esa persona.
      </p>
      <label className="checkbox">
        <input type="checkbox" checked={includeClosed} onChange={(e) => toggleClosed(e.target.checked)} />
        Incluir lo cerrado
      </label>
      {list}
    </section>
  );
}
