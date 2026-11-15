/**
 * Detalle de un tripulante (/tripulacion/:astronautId): una gráfica grande por indicador con los
 * mismos datos del dashboard (sin endpoints nuevos) y la tabla de puntos como alternativa.
 */
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { DashboardIndicator, IndicatorDef } from '../../api/types.ts';
import { useAuth } from '../../auth/context.ts';
import { Banner } from '../../components/Banner.tsx';
import { Loading, QueryError, UpdatedAgo } from '../../components/QueryStatus.tsx';
import { StatusBadge } from '../../components/StatusBadge.tsx';
import { dateClock, registeredLabel } from '../../lib/time.ts';
import { useNow } from '../../lib/useNow.ts';
import { AstronautFacts, TrendText } from './AstronautCard.tsx';
import { IndicatorChart } from './charts.tsx';
import { crewRoleLabel, formatReading, sortIndicators } from './crew.ts';
import { HiddenDataNotice } from './CrewDashboardPage.tsx';
import { DASHBOARD_POLL_MS, useCrewDashboard } from './useCrewDashboard.ts';
import './crew.css';

const COMPONENT_LABELS: Record<string, string> = { systolic: 'sistólica', diastolic: 'diastólica' };
const numberFormat = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });

/** "Valor principal (sistólica)" en indicadores compuestos. */
function seriesCaption(def: IndicatorDef | undefined): string {
  if (!def || def.value_type !== 'composite') return '';
  const main = def.components.find((c) => c.role === 'value') ?? def.components[0];
  return main ? `La serie muestra el valor principal (${COMPONENT_LABELS[main.name] ?? main.name}).` : '';
}

function IndicatorDetail({
  indicator,
  def,
  now,
}: {
  indicator: DashboardIndicator;
  def: IndicatorDef | undefined;
  now: number;
}) {
  const name = def?.name ?? indicator.code;
  const unit = def?.unit ?? '';
  const series = indicator.series ?? [];
  const headingId = `indicador-${indicator.code}`;
  return (
    <section className="indicator-detail" aria-labelledby={headingId}>
      <header className="crew-card-header">
        <h2 id={headingId}>{name}</h2>
        <StatusBadge level={indicator.level} />
      </header>
      <p>
        <strong className="indicator-value">{formatReading(indicator.last_value, def)}</strong>{' '}
        <span className="muted">· {registeredLabel(indicator.measured_at, now)} · </span>
        <TrendText trend={indicator.trend} />
      </p>
      {series.length >= 2 ? (
        <IndicatorChart points={series} unit={unit} name={name} />
      ) : (
        <p className="muted">Hace falta más de un punto para dibujar la serie.</p>
      )}
      <p className="muted small">
        {seriesCaption(def)} Sin umbrales en la gráfica: la API no los manda en el dashboard.
      </p>
      {series.length > 0 ? (
        <details>
          <summary>Ver los {series.length} puntos en tabla</summary>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Medido</th>
                <th scope="col">Valor{unit ? ` (${unit})` : ''}</th>
              </tr>
            </thead>
            <tbody>
              {series.map((p) => (
                <tr key={p.measured_at}>
                  <td>{dateClock(p.measured_at)}</td>
                  <td>{numberFormat.format(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </section>
  );
}

export function AstronautDetailPage() {
  const { astronautId } = useParams();
  const { role } = useAuth();
  const { mission, query, catalog, catalogSettled, screened } = useCrewDashboard();
  const now = useNow(DASHBOARD_POLL_MS);
  const astronaut = screened?.dashboard.astronauts.find((a) => a.astronaut_id === astronautId);

  let body: ReactNode;
  if (!screened || !catalogSettled) {
    body = query.isError ? (
      <QueryError error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <Loading label="Cargando…" />
    );
  } else if (!astronaut) {
    body = (
      <Banner tone="info">
        Este tripulante no está en el dashboard de la misión {mission?.code ?? ''} (o todavía no
        tiene lecturas físicas).
      </Banner>
    );
  } else {
    const indicators = sortIndicators(astronaut.indicators);
    body = (
      <>
        <div className="crew-card">
          <header className="crew-card-header">
            <div>
              <h1 id="detail-title">{astronaut.call_sign}</h1>
              <p className="muted">{crewRoleLabel(astronaut.crew_role)}</p>
            </div>
            <StatusBadge level={astronaut.worst_level} />
          </header>
          <AstronautFacts astronaut={astronaut} role={role} />
          <p className="muted small">
            <UpdatedAgo
              updatedAt={query.dataUpdatedAt}
              now={now}
              failed={query.isError}
              fetching={query.isFetching}
            />
          </p>
        </div>
        <HiddenDataNotice hidden={screened.hidden} />
        {indicators.length === 0 ? <p className="muted">Sin lecturas físicas.</p> : null}
        {indicators.map((indicator) => (
          <IndicatorDetail
            key={indicator.code}
            indicator={indicator}
            def={catalog?.get(indicator.code)}
            now={now}
          />
        ))}
      </>
    );
  }

  return (
    <section className="page stack" aria-labelledby={astronaut ? 'detail-title' : undefined}>
      <p>
        <Link to="/tripulacion">← Volver al dashboard</Link>
      </p>
      {body}
    </section>
  );
}
