/**
 * Cumplimiento del modo demo (GET /admin/compliance, solo admin): si hizo el check-in hoy, racha,
 * check-ins hechos y esperados en 7 días, cuestionarios y PVT hechos, último check-in y aptitud.
 * Nunca valores de bienestar. Un tripulante dado de alta en el demo sale "sin check-in".
 */
import type { ComplianceReport } from '../../types.ts';
import { MISSION_ID } from './mission.ts';
import { fitnessOf } from './readings.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

type Row = ComplianceReport['astronauts'][number];

/** Datos por indicativo (coherentes con el cumplimiento del dashboard de admin). */
const SEED: Record<string, { today: boolean; streak: number; done: number; screenings: number; pvt: number; lastHoursAgo: number }> = {
  ORION: { today: true, streak: 4, done: 6, screenings: 1, pvt: 2, lastHoursAgo: 3 },
  VEGA: { today: true, streak: 14, done: 7, screenings: 1, pvt: 2, lastHoursAgo: 2 },
  LYRA: { today: false, streak: 0, done: 5, screenings: 2, pvt: 2, lastHoursAgo: 30 },
  ATLAS: { today: true, streak: 9, done: 7, screenings: 1, pvt: 1, lastHoursAgo: 4 },
};

export interface ComplianceCrewEntry {
  astronaut_id: string;
  call_sign: string;
  /** false = alta hecha en el demo (sin check-ins todavía). */
  fixture: boolean;
}

export function buildCompliance(now: number, crew: ComplianceCrewEntry[]): ComplianceReport {
  const todayStart = Math.floor(now / DAY) * DAY;
  const from = todayStart - 6 * DAY;
  const astronauts: Row[] = crew.map((member) => {
    const seed = member.fixture ? SEED[member.call_sign] : undefined;
    if (!seed) {
      return {
        astronaut_id: member.astronaut_id,
        call_sign: member.call_sign,
        checkin_today: false,
        streak_days: 0,
        checkins_completed: 0,
        checkins_expected: 1,
        screenings_completed: 0,
        pvt_runs: 0,
        fitness: 'not_confirmed',
        last_checkin_at: null,
      };
    }
    return {
      astronaut_id: member.astronaut_id,
      call_sign: member.call_sign,
      checkin_today: seed.today,
      streak_days: seed.streak,
      checkins_completed: seed.done,
      checkins_expected: 7,
      screenings_completed: seed.screenings,
      pvt_runs: seed.pvt,
      fitness: fitnessOf(member.call_sign),
      last_checkin_at: iso(now - seed.lastHoursAgo * HOUR),
    };
  });
  return { mission_id: MISSION_ID, from: iso(from), to: iso(now), generated_at: iso(now), astronauts };
}
