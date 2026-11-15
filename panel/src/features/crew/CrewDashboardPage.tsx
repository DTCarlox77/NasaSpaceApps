/**
 * Dashboard de tripulación: GET /admin/dashboard/crew?mission_id= (x-roles: flight_surgeon,
 * admin) cada 30 s. Tarjetas ordenadas crítico → precaución → normal → sin datos, con filtro por
 * estado (?estado= en la URL). Sin nada conductual: el cumplimiento solo se muestra a admin.
 */
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../auth/context.ts';
import { Banner } from '../../components/Banner.tsx';
import { Loading, QueryError, UpdatedAgo } from '../../components/QueryStatus.tsx';
import { useNow } from '../../lib/useNow.ts';
import { clockTime } from '../../lib/time.ts';
import { AstronautCard } from './AstronautCard.tsx';
import {
  filterByLevel,
  LEVEL_LABELS,
  LEVEL_ORDER,
  sortAstronauts,
  type LevelFilter,
} from './crew.ts';
import { DASHBOARD_POLL_MS, useCrewDashboard } from './useCrewDashboard.ts';
import './crew.css';

const FILTERS: LevelFilter[] = ['all', ...LEVEL_ORDER];

function parseFilter(value: string | null): LevelFilter {
  return FILTERS.includes(value as LevelFilter) ? (value as LevelFilter) : 'all';
}

export function HiddenDataNotice({ hidden }: { hidden: number }) {
  if (hidden === 0) return null;
  return (
    <Banner tone="warning">
      La respuesta trajo {hidden} {hidden === 1 ? 'dato' : 'datos'} que este rol no debe ver (fuera
      del semáforo físico); no se muestran. Avisa al equipo del backend.
    </Banner>
  );
}

export function CrewDashboardPage() {
  const { role } = useAuth();
  const { mission, missionId, query, catalog, catalogSettled, screened } = useCrewDashboard();
  const [params, setParams] = useSearchParams();
  const filter = parseFilter(params.get('estado'));
  const now = useNow(DASHBOARD_POLL_MS);

  const astronauts = screened ? sortAstronauts(screened.dashboard.astronauts) : [];
  const visible = filterByLevel(astronauts, filter);
  const count = (f: LevelFilter) => filterByLevel(astronauts, f).length;

  function choose(next: LevelFilter) {
    setParams(next === 'all' ? {} : { estado: next }, { replace: true });
  }

  let body: ReactNode;
  if (!missionId) {
    body = <Banner tone="info">No tienes una misión asignada.</Banner>;
  } else if (!screened || !catalogSettled) {
    body = query.isError ? (
      <QueryError error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <Loading label="Cargando el dashboard…" />
    );
  } else if (astronauts.length === 0) {
    body = <p className="muted">Todavía no hay lecturas físicas en esta misión.</p>;
  } else {
    body = (
      <>
        <div className="filter-bar" role="group" aria-label="Filtrar por estado">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className="filter-chip"
              aria-pressed={filter === f}
              onClick={() => choose(f)}
            >
              {f === 'all' ? 'Todos' : LEVEL_LABELS[f]} ({count(f)})
            </button>
          ))}
        </div>
        {visible.length === 0 ? (
          <p className="muted">Ningún tripulante en «{filter === 'all' ? 'Todos' : LEVEL_LABELS[filter]}».</p>
        ) : (
          <div className="crew-grid">
            {visible.map((astronaut) => (
              <AstronautCard
                key={astronaut.astronaut_id}
                astronaut={astronaut}
                role={role}
                catalog={catalog}
                now={now}
              />
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <section className="page page-wide stack" aria-labelledby="crew-title">
      <div className="page-header">
        <div>
          <p className="eyebrow">Misión {mission?.code ?? '—'}</p>
          <h1 id="crew-title">Dashboard de tripulación</h1>
          <p className="muted">
            Semáforo físico por tripulante. Apoyo a la decisión, no diagnóstico.
          </p>
        </div>
        {screened ? (
          <p className="muted page-header-meta">
            <UpdatedAgo
              updatedAt={query.dataUpdatedAt}
              now={now}
              failed={query.isError}
              fetching={query.isFetching}
            />
            <br />
            Generado por el servidor a las {clockTime(screened.dashboard.generated_at)} · se
            actualiza cada 30 s
          </p>
        ) : null}
      </div>
      {screened ? <HiddenDataNotice hidden={screened.hidden} /> : null}
      {body}
    </section>
  );
}
