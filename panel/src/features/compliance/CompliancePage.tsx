/**
 * Cumplimiento (/cumplimiento), SOLO admin = control de misión. GET /admin/compliance?mission_id=
 * cada 60 s: por tripulante, check-in hoy, racha, check-ins de la semana, último check-in y "apto
 * para tarea crítica" (Apto / No confirmado). Solo lo que manda la API; nunca valores de bienestar.
 */
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCompliance } from '../../api/admin.ts';
import { queryKeys } from '../../api/queryKeys.ts';
import { Banner } from '../../components/Banner.tsx';
import { Loading, QueryError, UpdatedAgo } from '../../components/QueryStatus.tsx';
import { dateClock, dayClock, timeAgo } from '../../lib/time.ts';
import { useNow } from '../../lib/useNow.ts';
import { useMission } from '../../mission/useMission.ts';
import { COMPLIANCE_NOTE, FITNESS_META, neverCheckedIn, screenCompliance, streakLabel } from './compliance.ts';
import './compliance.css';

export const COMPLIANCE_POLL_MS = 60_000;

export function CompliancePage() {
  const { missionId, mission } = useMission();
  const now = useNow(30_000);
  const query = useQuery({
    queryKey: queryKeys.compliance(missionId ?? ''),
    queryFn: ({ signal }) => getCompliance(missionId as string, signal),
    enabled: !!missionId,
    refetchInterval: COMPLIANCE_POLL_MS,
  });

  let body: ReactNode;
  if (!missionId) {
    body = <Banner tone="info">No tienes una misión asignada.</Banner>;
  } else if (!query.data) {
    body = query.isError ? (
      <QueryError error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <Loading label="Cargando el cumplimiento…" />
    );
  } else {
    const { report, dropped } = screenCompliance(query.data);
    const rows = [...report.astronauts].sort((a, b) => a.call_sign.localeCompare(b.call_sign));
    body = (
      <>
        <p className="muted small">
          Del {dateClock(report.from)} al {dateClock(report.to)} (días UTC).
          {dropped > 0 ? ` Se ocultaron ${dropped} dato(s) que no son de cumplimiento.` : ''}
        </p>
        <table className="data-table compliance-table">
          <caption className="visually-hidden">Cumplimiento por tripulante</caption>
          <thead>
            <tr>
              <th scope="col">Tripulante</th>
              <th scope="col">Check-in hoy</th>
              <th scope="col">Racha</th>
              <th scope="col">Check-ins (semana)</th>
              <th scope="col">Último check-in</th>
              <th scope="col">Apto para tarea crítica</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const never = neverCheckedIn(row);
              const fit = FITNESS_META[row.fitness] ?? { icon: '·', text: row.fitness };
              return (
                <tr key={row.astronaut_id}>
                  <th scope="row">{row.call_sign}</th>
                  <td>
                    {never ? (
                      <span className="chip chip-none">
                        <span aria-hidden="true">○</span> Sin check-in
                      </span>
                    ) : row.checkin_today === undefined ? (
                      'Sin dato'
                    ) : row.checkin_today ? (
                      <span className="chip chip-yes">
                        <span aria-hidden="true">✓</span> Sí
                      </span>
                    ) : (
                      <span className="chip chip-no">
                        <span aria-hidden="true">○</span> No
                      </span>
                    )}
                  </td>
                  <td>{streakLabel(row.streak_days)}</td>
                  <td>
                    {row.checkins_completed} de {row.checkins_expected}
                  </td>
                  <td>
                    {row.last_checkin_at ? (
                      <>
                        {dayClock(row.last_checkin_at, now)}{' '}
                        <span className="muted small">({timeAgo(row.last_checkin_at, now)})</span>
                      </>
                    ) : (
                      'Sin check-in'
                    )}
                  </td>
                  <td>
                    <span className={`chip chip-fitness-${row.fitness}`}>
                      <span aria-hidden="true">{fit.icon}</span> {fit.text}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </>
    );
  }

  return (
    <section className="page page-wide stack" aria-labelledby="compliance-title">
      <div className="page-header">
        <div>
          <p className="eyebrow">Misión {mission?.code ?? '—'}</p>
          <h1 id="compliance-title">Cumplimiento</h1>
          <p className="compliance-note" role="note">
            <span aria-hidden="true">◆</span> {COMPLIANCE_NOTE}
          </p>
        </div>
        {query.data ? (
          <p className="muted page-header-meta">
            <UpdatedAgo updatedAt={query.dataUpdatedAt} now={now} failed={query.isError} fetching={query.isFetching} />
            <br />
            Se actualiza cada 60 s
          </p>
        ) : null}
      </div>
      <p className="muted">
        Check-ins completados y aptitud por tripulante: lo único de bienestar que ve control de misión. "Apto para
        tarea crítica" sale de una prueba de reacción de las últimas 12 h.
      </p>
      {body}
    </section>
  );
}
