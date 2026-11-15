/** Tarjeta de un tripulante: semáforo físico por indicador, último valor, serie y tendencia. */
import { Link } from 'react-router';
import type { DashboardAstronaut, DashboardIndicator, GroundRole, IndicatorDef } from '../../api/types.ts';
import { StatusBadge } from '../../components/StatusBadge.tsx';
import { registeredLabel } from '../../lib/time.ts';
import { Sparkline } from './charts.tsx';
import {
  complianceLabel,
  crewRoleLabel,
  NO_READINGS_TEXT,
  fitnessLabel,
  formatReading,
  sortIndicators,
  TREND_LABELS,
} from './crew.ts';

export function TrendText({ trend }: { trend: DashboardIndicator['trend'] }) {
  const meta = TREND_LABELS[trend] ?? TREND_LABELS.insufficient_data;
  return (
    <span className="trend">
      <span aria-hidden="true">{meta.icon}</span> {meta.text}
    </span>
  );
}

export function AstronautFacts({ astronaut, role }: { astronaut: DashboardAstronaut; role: GroundRole | null }) {
  const fit = astronaut.fitness;
  return (
    <dl className="crew-facts">
      <div>
        <dt>Aptitud</dt>
        <dd>
          <span aria-hidden="true">{fit === 'fit' ? '✓ ' : fit === 'not_confirmed' ? '? ' : ''}</span>
          {fitnessLabel(fit)}
        </dd>
      </div>
      <div>
        <dt>Cumplimiento</dt>
        <dd>{complianceLabel(astronaut.compliance, role)}</dd>
      </div>
    </dl>
  );
}

function IndicatorRow({
  indicator,
  def,
  now,
}: {
  indicator: DashboardIndicator;
  def: IndicatorDef | undefined;
  now: number;
}) {
  return (
    <li className="indicator-row">
      <div className="indicator-main">
        <span className="indicator-name">{def?.name ?? indicator.code}</span>
        <StatusBadge level={indicator.level} />
      </div>
      <div className="indicator-value">{formatReading(indicator.last_value, def)}</div>
      <div className="indicator-meta muted">{registeredLabel(indicator.measured_at, now)}</div>
      <div className="indicator-trend">
        <Sparkline points={indicator.series ?? []} unit={def?.unit} />
        <TrendText trend={indicator.trend} />
      </div>
    </li>
  );
}

export function AstronautCard({
  astronaut,
  role,
  catalog,
  now,
}: {
  astronaut: DashboardAstronaut;
  role: GroundRole | null;
  catalog: Map<string, IndicatorDef> | null;
  now: number;
}) {
  const headingId = `astronauta-${astronaut.astronaut_id}`;
  const indicators = sortIndicators(astronaut.indicators);
  // Sin lecturas (p. ej. alta reciente): ningún semáforo, solo el texto.
  const noReadings = indicators.length === 0;
  return (
    <article className={`crew-card crew-card-${noReadings ? 'empty' : astronaut.worst_level}`} aria-labelledby={headingId}>
      <header className="crew-card-header">
        <div>
          <h2 id={headingId}>{astronaut.call_sign}</h2>
          <p className="muted">{crewRoleLabel(astronaut.crew_role)}</p>
        </div>
        {noReadings ? (
          <span className="no-readings">
            <span aria-hidden="true">○</span> {NO_READINGS_TEXT}
          </span>
        ) : (
          <StatusBadge level={astronaut.worst_level} />
        )}
      </header>
      <AstronautFacts astronaut={astronaut} role={role} />
      {indicators.length > 0 ? (
        <ul className="indicator-list">
          {indicators.map((indicator) => (
            <IndicatorRow
              key={indicator.code}
              indicator={indicator}
              def={catalog?.get(indicator.code)}
              now={now}
            />
          ))}
        </ul>
      ) : (
        <p className="muted">{NO_READINGS_TEXT}: aparecerán cuando la app envíe sus primeras mediciones.</p>
      )}
      <Link className="crew-card-link" to={`/tripulacion/${astronaut.astronaut_id}`}>
        Ver detalle de {astronaut.call_sign}
      </Link>
    </article>
  );
}
