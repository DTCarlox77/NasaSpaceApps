/**
 * Lecturas físicas del modo demo: 14 días por tripulante e indicador, con alguna precaución
 * (ORION presión, VEGA pulso, LYRA SpO₂) y una crítica (LYRA frecuencia respiratoria).
 * Los niveles son DATOS del fixture (en la API los calcula el motor); el panel no los calcula.
 * Sin SLEEP_HOURS: desde v1.8 no sale en el dashboard para ningún rol.
 */
import type { Compliance, CrewDashboard, CrewRole, DashboardIndicator, Level, Trend } from '../../types.ts';
import { CREW } from './people.ts';
import { MISSION_ID } from './mission.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const DAYS = 14;
/** El dashboard manda hasta 10 puntos por indicador (contrato). */
const SERIES_MAX = 10;

interface Spec {
  code: string;
  level: Level;
  /** Valor principal de los 14 días (el último es el más reciente). */
  values: number[];
  /** Solo la presión: diastólica de los 14 días. */
  diastolic?: number[];
  /** Minutos antes de t0 de la última lectura. */
  lastMinutesAgo: number;
}

/** 14 valores que oscilan alrededor de `base`; `tail` reemplaza los últimos. */
function daily(base: number, spread: number, phase: number, decimals: number, tail: number[] = []): number[] {
  const factor = 10 ** decimals;
  const values = Array.from({ length: DAYS }, (_, i) =>
    Math.round((base + spread * Math.sin(i * 1.7 + phase)) * factor) / factor,
  );
  return [...values.slice(0, DAYS - tail.length), ...tail];
}

const SPECS: Record<string, Spec[]> = {
  ORION: [
    {
      code: 'BLOOD_PRESSURE',
      level: 'caution',
      values: daily(121, 4, 0.3, 0, [128, 136, 145]),
      diastolic: daily(78, 3, 0.8, 0, [82, 85, 88]),
      lastMinutesAgo: 130,
    },
    { code: 'HEART_RATE', level: 'normal', values: daily(64, 3, 1.1, 0), lastMinutesAgo: 130 },
    { code: 'SPO2', level: 'normal', values: daily(98, 0.6, 2.0, 0), lastMinutesAgo: 130 },
    { code: 'BODY_TEMP', level: 'normal', values: daily(36.7, 0.2, 0.4, 1), lastMinutesAgo: 130 },
    { code: 'RAD_DOSE_DAILY', level: 'normal', values: daily(0.46, 0.05, 1.4, 2, [0.52]), lastMinutesAgo: 60 },
  ],
  VEGA: [
    { code: 'HEART_RATE', level: 'caution', values: daily(68, 3, 0.2, 0, [79, 88, 96]), lastMinutesAgo: 95 },
    {
      code: 'BLOOD_PRESSURE',
      level: 'normal',
      values: daily(117, 4, 1.9, 0),
      diastolic: daily(75, 3, 2.3, 0),
      lastMinutesAgo: 95,
    },
    { code: 'SPO2', level: 'normal', values: daily(98, 0.5, 0.9, 0), lastMinutesAgo: 95 },
    { code: 'BODY_TEMP', level: 'normal', values: daily(36.6, 0.2, 1.6, 1), lastMinutesAgo: 95 },
    { code: 'RAD_DOSE_DAILY', level: 'normal', values: daily(0.45, 0.05, 0.6, 2, [0.5]), lastMinutesAgo: 60 },
  ],
  LYRA: [
    { code: 'RESP_RATE', level: 'critical', values: daily(15, 1.5, 0.5, 0, [18, 24, 31]), lastMinutesAgo: 35 },
    { code: 'SPO2', level: 'caution', values: daily(97, 0.7, 1.2, 0, [95, 93]), lastMinutesAgo: 35 },
    { code: 'HEART_RATE', level: 'normal', values: daily(72, 3, 2.4, 0, [84]), lastMinutesAgo: 35 },
    { code: 'BODY_TEMP', level: 'normal', values: daily(36.8, 0.2, 0.1, 1, [37.3]), lastMinutesAgo: 35 },
    { code: 'RAD_DOSE_DAILY', level: 'normal', values: daily(0.47, 0.05, 2.2, 2, [0.58]), lastMinutesAgo: 60 },
  ],
  ATLAS: [
    { code: 'HEART_RATE', level: 'normal', values: daily(61, 2, 0.7, 0), lastMinutesAgo: 170 },
    {
      code: 'BLOOD_PRESSURE',
      level: 'normal',
      values: daily(115, 3, 0.1, 0),
      diastolic: daily(74, 2, 1.0, 0),
      lastMinutesAgo: 170,
    },
    { code: 'SPO2', level: 'normal', values: daily(99, 0.4, 1.5, 0), lastMinutesAgo: 170 },
    { code: 'RAD_DOSE_DAILY', level: 'normal', values: daily(0.44, 0.04, 1.8, 2), lastMinutesAgo: 60 },
  ],
};

const COMPLIANCE: Record<string, Compliance> = {
  ORION: { checkins_completed_7d: 6, checkins_expected_7d: 7 },
  VEGA: { checkins_completed_7d: 7, checkins_expected_7d: 7 },
  LYRA: { checkins_completed_7d: 5, checkins_expected_7d: 7 },
  ATLAS: { checkins_completed_7d: 7, checkins_expected_7d: 7 },
};

const FITNESS: Record<string, 'fit' | 'not_confirmed'> = {
  ORION: 'fit',
  VEGA: 'fit',
  LYRA: 'not_confirmed',
  ATLAS: 'fit',
};

const LEVEL_RANK: Level[] = ['critical', 'caution', 'normal', 'unrated'];

/** Tendencia del contrato: último valor frente a la media de los anteriores, ±5 %. */
export function trendOf(values: number[]): Trend {
  if (values.length < 2) return 'insufficient_data';
  const last = values[values.length - 1] as number;
  const previous = values.slice(0, -1);
  const mean = previous.reduce((a, b) => a + b, 0) / previous.length;
  if (last > mean * 1.05) return 'rising';
  if (last < mean * 0.95) return 'falling';
  return 'stable';
}

function indicator(spec: Spec, t0: number): DashboardIndicator {
  const lastAt = t0 - spec.lastMinutesAgo * MINUTE;
  const at = (i: number) => new Date(lastAt - (DAYS - 1 - i) * DAY).toISOString();
  const series = spec.values.map((value, i) => ({ measured_at: at(i), value })).slice(-SERIES_MAX);
  const last = spec.values[DAYS - 1] as number;
  const lastValue = spec.diastolic
    ? { systolic: last, diastolic: spec.diastolic[DAYS - 1] as number }
    : { value: last };
  return {
    code: spec.code,
    level: spec.level,
    last_value: lastValue,
    measured_at: at(DAYS - 1),
    trend: trendOf(series.map((p) => p.value)),
    series,
  };
}

export interface DashboardCrewEntry {
  astronaut_id: string;
  call_sign: string;
  crew_role: CrewRole;
  /** false = alta hecha en el demo: todavía sin lecturas, check-ins ni PVT. */
  fixture: boolean;
}

/** Tripulación del seed (para quien llama sin la lista del estado). */
const SEED_CREW: DashboardCrewEntry[] = CREW.map((c) => ({
  astronaut_id: c.astronaut_id,
  call_sign: c.call_sign,
  crew_role: c.crew_role,
  fixture: true,
}));

/** Aptitud del demo por indicativo (la misma que ve el dashboard). */
export const fitnessOf = (callSign: string): 'fit' | 'not_confirmed' => FITNESS[callSign] ?? 'not_confirmed';

/**
 * GET /admin/dashboard/crew. `compliance` solo para admin (null para el flight surgeon).
 * Un tripulante dado de alta en el demo sale sin indicadores ("Sin lecturas todavía"), con nivel
 * `unrated`, 0 check-ins y aptitud `not_confirmed` (no tiene PVT).
 */
export function crewDashboard(
  t0: number,
  now: number,
  withCompliance: boolean,
  crew: DashboardCrewEntry[] = SEED_CREW,
): CrewDashboard {
  return {
    mission_id: MISSION_ID,
    mission_code: 'ARES-1',
    generated_at: new Date(now).toISOString(),
    astronauts: crew.map((member) => {
      const indicators = member.fixture ? (SPECS[member.call_sign] ?? []).map((spec) => indicator(spec, t0)) : [];
      const worst =
        LEVEL_RANK.find((level) => indicators.some((i) => i.level === level)) ?? 'unrated';
      const compliance = member.fixture
        ? (COMPLIANCE[member.call_sign] ?? null)
        : { checkins_completed_7d: 0, checkins_expected_7d: 1 };
      return {
        astronaut_id: member.astronaut_id,
        call_sign: member.call_sign,
        crew_role: member.crew_role,
        worst_level: worst,
        indicators,
        compliance: withCompliance ? compliance : null,
        fitness: member.fixture ? fitnessOf(member.call_sign) : 'not_confirmed',
      };
    }),
  };
}
