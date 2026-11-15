/** Resumen en texto del estado del enlace (GET /missions/current). */
import type { CommOutage, CurrentMission } from '../api/types.ts';
import { clockTime, dateClock, formatDelay } from '../lib/time.ts';

export const LINK_POLL_MS = 30_000;

const gravityFormat = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });

/** hh:mm si es hoy; si no, dd/mm hh:mm. */
function when(iso: string, now: number): string {
  const sameDay = new Date(iso).toDateString() === new Date(now).toDateString();
  return sameDay ? clockTime(iso) : dateClock(iso);
}

function nextOutage(outages: CommOutage[], now: number): CommOutage | null {
  return (
    [...outages]
      .filter((o) => new Date(o.starts_at).getTime() > now)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null
  );
}

export interface LinkSummary {
  tone: 'up' | 'down';
  /** "Enlace activo · retraso 90 s" o "Sin enlace · corte en curso hasta 20:00". */
  headline: string;
  /** "Próximo corte: 18:00–20:00 · Conjunción solar (demo)" (vacío si no hay). */
  next: string;
  /** "Tránsito a Marte · 0 g". */
  environment: string;
}

export function summarizeLink(data: CurrentMission, now: number): LinkSummary {
  const { comm, environment } = data;
  let headline: string;
  if (comm.link === 'down') {
    const until = comm.current_outage?.ends_at;
    headline = until
      ? `Sin enlace · corte en curso hasta las ${when(until, now)}`
      : 'Sin enlace · corte en curso, sin hora de fin';
  } else {
    headline = `Enlace activo · retraso ${formatDelay(comm.delay_seconds)}`;
  }
  const upcoming = nextOutage(comm.upcoming_outages ?? [], now);
  const next = upcoming
    ? `Próximo corte: ${when(upcoming.starts_at, now)}${
        upcoming.ends_at ? `–${when(upcoming.ends_at, now)}` : ''
      } · ${upcoming.reason}`
    : '';
  return {
    tone: comm.link === 'down' ? 'down' : 'up',
    headline,
    next,
    environment: `${environment.name} · ${gravityFormat.format(environment.gravity_g)} g`,
  };
}
