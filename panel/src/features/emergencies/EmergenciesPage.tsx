/**
 * Emergencias (/emergencias): sesiones de triaje que ya llegaron a Tierra, la más reciente
 * primero. Filtro por estado (?estado=), "Cargar más" y sondeo cada 10 s con una emergencia
 * abierta (30 s si no). admin ve solo el estado operativo (sin conteos de triaje).
 */
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { EmergencyFilter } from '../../api/emergencies.ts';
import type { EmergencyListItem } from '../../api/types.ts';
import { useAuth } from '../../auth/context.ts';
import { Banner } from '../../components/Banner.tsx';
import { Button } from '../../components/Button.tsx';
import { Loading, QueryError, UpdatedAgo } from '../../components/QueryStatus.tsx';
import { dayClock, timeAgo } from '../../lib/time.ts';
import { useNow } from '../../lib/useNow.ts';
import { useMission } from '../../mission/useMission.ts';
import { EmergencyStatusBadge, TriageBadge } from './badges.tsx';
import {
  ADMIN_OPERATIONAL_NOTE,
  anyOpen,
  countsLabel,
  EMERGENCY_DISCLAIMER,
  POLL_OPEN_MS,
  STATUS_FILTERS,
  STATUS_META,
  triggerLabel,
  worstCategory,
} from './emergencies.ts';
import { useEmergencyList } from './useEmergencies.ts';
import './emergencies.css';

function EmergencyRow({ item, clinical, now }: { item: EmergencyListItem; clinical: boolean; now: number }) {
  const worst = clinical ? worstCategory(item.counts) : null;
  return (
    <li className={`emergency-row emergency-row-${item.status}`}>
      <Link to={`/emergencias/${encodeURIComponent(item.id)}`} className="emergency-link">
        <span className="row">
          <EmergencyStatusBadge status={item.status} />
          <strong>
            Inicio {dayClock(item.started_at, now)} <span className="muted">({timeAgo(item.started_at, now)})</span>
          </strong>
        </span>
        <span className="small">Abrió: {triggerLabel(item.trigger_type)}</span>
        <span className="muted small">
          Llegó a Tierra a las {dayClock(item.first_delivered_at, now)}
          {item.closed_at ? ` · cerrada a las ${dayClock(item.closed_at, now)}` : ''}
        </span>
        {clinical && item.counts ? (
          <span className="row small">
            <span>{countsLabel(item.counts)}</span>
            <span>Peor categoría:</span>
            <TriageBadge category={worst} />
          </span>
        ) : null}
      </Link>
    </li>
  );
}

export function EmergenciesPage() {
  const { role } = useAuth();
  const { mission } = useMission();
  const [params, setParams] = useSearchParams();
  const raw = params.get('estado');
  const status = raw && (STATUS_FILTERS as readonly string[]).includes(raw) ? (raw as EmergencyFilter) : undefined;
  const { missionId, query, items } = useEmergencyList(status);
  const now = useNow(POLL_OPEN_MS);
  const clinical = role === 'flight_surgeon';
  const open = anyOpen(items);

  function setStatus(value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set('estado', value);
    else next.delete('estado');
    setParams(next, { replace: true });
  }

  let list: ReactNode;
  if (!missionId) {
    list = <Banner tone="info">No tienes una misión asignada.</Banner>;
  } else if (!query.data) {
    list = query.isError ? (
      <QueryError error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <Loading label="Cargando las emergencias…" />
    );
  } else if (items.length === 0) {
    list = <p className="muted">No hay emergencias {status ? 'con este estado' : 'que hayan llegado a Tierra'}.</p>;
  } else {
    list = (
      <>
        <ul className="emergency-list" aria-label="Emergencias">
          {items.map((item) => (
            <EmergencyRow key={item.id} item={item} clinical={clinical} now={now} />
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
    <section className="page page-wide stack" aria-labelledby="emergencies-title">
      <div className="page-header">
        <div>
          <p className="eyebrow">Misión {mission?.code ?? '—'}</p>
          <h1 id="emergencies-title">Emergencias</h1>
          <p className="emergency-disclaimer">{EMERGENCY_DISCLAIMER}</p>
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
            {open ? 'Hay una emergencia abierta: se actualiza cada 10 s' : 'Se actualiza cada 30 s'}
          </p>
        ) : null}
      </div>

      {role === 'admin' ? <Banner tone="info">{ADMIN_OPERATIONAL_NOTE}</Banner> : null}

      <div className="filter-row">
        <div className="field">
          <label htmlFor="filter-emergency-status">Estado</label>
          <select id="filter-emergency-status" value={status ?? ''} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].text}
              </option>
            ))}
          </select>
        </div>
      </div>

      {list}
    </section>
  );
}
