/**
 * Estado del enlace con la nave en la cabecera: GET /missions/current?mission_id= cada 30 s
 * (x-roles: astronaut, flight_surgeon, behavioral_health, admin; NO /admin/comm-outages, que es
 * solo de admin). Siempre con texto y símbolo, no solo color.
 */
import { useQuery } from '@tanstack/react-query';
import { HttpError } from '../api/http.ts';
import { getCurrentMission } from '../api/missions.ts';
import { queryKeys } from '../api/queryKeys.ts';
import { useNow } from '../lib/useNow.ts';
import { useMission } from '../mission/useMission.ts';
import { LINK_POLL_MS, summarizeLink } from '../mission/link.ts';

export function LinkStatus() {
  const { missionId } = useMission();
  const now = useNow(LINK_POLL_MS);
  const query = useQuery({
    queryKey: queryKeys.currentMission(missionId ?? ''),
    queryFn: ({ signal }) => getCurrentMission(missionId as string, signal),
    enabled: !!missionId,
    refetchInterval: LINK_POLL_MS,
  });

  if (!missionId) return null;

  // Sin datos (o sin la forma del contrato): texto neutro, nunca un estado inventado.
  if (!query.data?.comm || !query.data.environment) {
    const text = query.isError
      ? query.error instanceof HttpError && query.error.status === 403
        ? 'Enlace: sin acceso'
        : 'Enlace: sin datos (reintentando)'
      : 'Enlace: consultando…';
    return (
      <div className="link-status link-unknown">
        <span aria-hidden="true">○</span> {text}
      </div>
    );
  }

  const summary = summarizeLink(query.data, now);
  return (
    <div className={`link-status link-${summary.tone}`} aria-label="Estado del enlace con la nave">
      <span className="link-headline">
        <span aria-hidden="true">{summary.tone === 'up' ? '●' : '■'}</span> {summary.headline}
        {query.isError ? <span className="muted"> (sin actualizar)</span> : null}
      </span>
      <span className="link-meta">
        {summary.environment}
        {summary.next ? ` · ${summary.next}` : ''}
      </span>
    </div>
  );
}
