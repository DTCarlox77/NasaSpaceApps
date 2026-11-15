/**
 * Bandeja de alertas: lo que ya llegó a Tierra, por prioridad y luego por llegada. Filtros por
 * categoría y estado (?categoria=&estado=), "Cargar más" con el cursor, sondeo cada 15 s y
 * detalle de la alerta elegida (?alerta=<id>).
 */
import { useRef, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { InboxFilters } from '../../api/queryKeys.ts';
import type { InboxCategory, InboxItem } from '../../api/types.ts';
import { useAuth } from '../../auth/context.ts';
import { Banner } from '../../components/Banner.tsx';
import { Button } from '../../components/Button.tsx';
import { Loading, QueryError, UpdatedAgo } from '../../components/QueryStatus.tsx';
import { clockTime, registeredLabel } from '../../lib/time.ts';
import { useNow } from '../../lib/useNow.ts';
import { useMission } from '../../mission/useMission.ts';
import { AlertDetail } from './AlertDetail.tsx';
import {
  CATEGORY_LABELS,
  categoryOptions,
  crewLabel,
  isWellbeing,
  STATUS_FILTERS,
  STATUS_LABELS,
  triageLabel,
  WELLBEING_TEXT,
} from './inbox.ts';
import { PriorityBadge } from './PriorityBadge.tsx';
import { INBOX_POLL_MS, useInbox } from './useInbox.ts';
import './alerts.css';

function readFilters(params: URLSearchParams, allowed: InboxCategory[]): InboxFilters {
  const category = params.get('categoria') as InboxCategory | null;
  const status = params.get('estado') as InboxFilters['status'] | null;
  return {
    ...(category && allowed.includes(category) ? { category } : {}),
    ...(status && (STATUS_FILTERS as readonly string[]).includes(status) ? { status } : {}),
  };
}

function InboxRow({
  item,
  selected,
  href,
  now,
}: {
  item: InboxItem;
  selected: boolean;
  href: string;
  now: number;
}) {
  const wellbeing = isWellbeing(item);
  const triage = wellbeing ? '' : triageLabel(item);
  return (
    <li className={`inbox-row inbox-${item.priority}${selected ? ' selected' : ''}`}>
      <Link to={href} aria-current={selected ? 'true' : undefined} className="inbox-link">
        <span className="row">
          <PriorityBadge priority={item.priority} />
          <strong>{crewLabel(item)}</strong>
          <span className="tag">{CATEGORY_LABELS[item.category] ?? item.category}</span>
          <span className="tag">{STATUS_LABELS[item.status] ?? item.status}</span>
        </span>
        <span className="inbox-reason">{wellbeing ? WELLBEING_TEXT : item.reason}</span>
        {triage ? <span className="small">{triage}</span> : null}
        <span className="muted small">
          {wellbeing
            ? `Llegó a Tierra a las ${clockTime(item.deliver_at)}`
            : `${registeredLabel(item.measured_at ?? item.created_at, now, item.lag_s, item.late_sync)} · llegó a Tierra a las ${clockTime(item.deliver_at)}`}
        </span>
      </Link>
    </li>
  );
}

export function AlertsPage() {
  const { role } = useAuth();
  const { mission } = useMission();
  const [params, setParams] = useSearchParams();
  const allowedCategories = categoryOptions(role);
  const filters = readFilters(params, allowedCategories);
  const selectedId = params.get('alerta');
  const { missionId, query, items } = useInbox(filters);
  const now = useNow(INBOX_POLL_MS);

  // La alerta elegida puede salir de la vista (p. ej. tras el acuse con el filtro "Sin acuse"):
  // se conserva la última versión vista para no cerrar el detalle.
  const lastSeen = useRef(new Map<string, InboxItem>());
  for (const item of items) lastSeen.current.set(item.id, item);
  const selected = selectedId
    ? (items.find((i) => i.id === selectedId) ?? lastSeen.current.get(selectedId) ?? null)
    : null;

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('alerta');
    setParams(next, { replace: true });
  }

  function hrefFor(id: string) {
    const next = new URLSearchParams(params);
    next.set('alerta', id);
    return `?${next.toString()}`;
  }

  const closeParams = new URLSearchParams(params);
  closeParams.delete('alerta');
  const closeHref = `?${closeParams.toString()}`;

  let list: ReactNode;
  if (!missionId) {
    list = <Banner tone="info">No tienes una misión asignada.</Banner>;
  } else if (!query.data) {
    list = query.isError ? (
      <QueryError error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <Loading label="Cargando la bandeja…" />
    );
  } else if (items.length === 0) {
    list = <p className="muted">No hay alertas con estos filtros.</p>;
  } else {
    list = (
      <>
        <ul className="inbox-list" aria-label="Alertas">
          {items.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              href={hrefFor(item.id)}
              now={now}
            />
          ))}
        </ul>
        {query.hasNextPage ? (
          <div>
            <Button
              variant="secondary"
              onClick={() => void query.fetchNextPage()}
              loading={query.isFetchingNextPage}
            >
              Cargar más
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <section className="page page-wide stack" aria-labelledby="alerts-title">
      <div className="page-header">
        <div>
          <p className="eyebrow">Misión {mission?.code ?? '—'}</p>
          <h1 id="alerts-title">Alertas</h1>
          <p className="muted">
            Escalamientos que ya llegaron a Tierra, por prioridad y luego por llegada.
          </p>
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
            Se actualiza cada 15 s
          </p>
        ) : null}
      </div>

      <div className="filter-row">
        <div className="field">
          <label htmlFor="filter-category">Categoría</label>
          <select
            id="filter-category"
            value={filters.category ?? ''}
            onChange={(e) => setParam('categoria', e.target.value)}
          >
            <option value="">Todas</option>
            {allowedCategories.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="filter-status">Estado</label>
          <select
            id="filter-status"
            value={filters.status ?? ''}
            onChange={(e) => setParam('estado', e.target.value)}
          >
            <option value="">Todos</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={`alerts-layout${selected ? ' with-detail' : ''}`}>
        <div className="stack">{list}</div>
        {selected && missionId ? (
          <aside className="alerts-detail-panel" aria-label="Detalle de la alerta">
            <p>
              <Link to={closeHref}>× Cerrar detalle</Link>
            </p>
            <AlertDetail key={selected.id} item={selected} missionId={missionId} role={role} now={now} />
          </aside>
        ) : null}
      </div>
    </section>
  );
}
