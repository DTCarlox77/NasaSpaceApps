/**
 * Bienestar del modo demo (CONFIDENCIAL, solo behavioral_health; datos sintéticos).
 * - 14 check-ins por tripulante (ánimo, fatiga, estrés, roces y sueño). NUNCA la nota privada:
 *   ni existe en estos datos (en la API solo la ve el astronauta).
 * - VEGA: estrés distinto de lo habitual 5 días seguidos. LYRA: ánimo bajo 4 días, PHQ-2 positivo
 *   y PVT con aptitud no confirmada. ORION: alerta de fatiga ya cerrada. ATLAS: estable.
 * - Solicitudes "Quiero hablar con alguien" (now, today, later) y una que todavía viaja a Tierra.
 */
import type {
  BehavioralCheckin,
  BehavioralIndicator,
  ConfidentialAccess,
  Level,
  PvtRun,
  Screening,
  SupportRequest,
} from '../../types.ts';
import { DELAY_S } from './mission.ts';
import { crewByCallSign, groundUser } from './people.ts';
import { trendOf } from './readings.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const DAYS = 14;
const iso = (ms: number) => new Date(ms).toISOString();

type Slider = 'mood' | 'fatigue' | 'stress' | 'crew_conflict';

/** Indicador del catálogo para cada deslizador y si lo adverso es subir o bajar. */
export const SLIDERS: { key: Slider; code: string; adverse: 'high' | 'low' }[] = [
  { key: 'mood', code: 'WB_MOOD', adverse: 'low' },
  { key: 'fatigue', code: 'WB_FATIGUE', adverse: 'high' },
  { key: 'stress', code: 'WB_STRESS', adverse: 'high' },
  { key: 'crew_conflict', code: 'WB_CREW_CONFLICT', adverse: 'high' },
];

function series(base: number, spread: number, phase: number, tail: number[] = []): number[] {
  const values = Array.from({ length: DAYS }, (_, i) =>
    Math.max(0, Math.min(100, Math.round(base + spread * Math.sin(i * 1.9 + phase)))),
  );
  return [...values.slice(0, DAYS - tail.length), ...tail];
}

interface Profile {
  values: Record<Slider, number[]>;
  sleep: number[];
  /** Nivel y días sostenidos por indicador (en la API los calcula el motor). */
  levels: Partial<Record<string, { level: Level; sustained: number }>>;
  /** Hora UTC aproximada del check-in. */
  hour: number;
}

const PROFILES: Record<string, Profile> = {
  ORION: {
    values: {
      mood: series(66, 5, 0.2),
      fatigue: series(44, 5, 1.1, [70, 74, 72, 52, 48, 46]),
      stress: series(40, 6, 2.0),
      crew_conflict: series(14, 4, 0.7),
    },
    sleep: series(68, 4, 0.5).map((v) => v / 10),
    levels: {},
    hour: 21,
  },
  VEGA: {
    values: {
      mood: series(62, 4, 1.4),
      fatigue: series(50, 5, 0.3),
      stress: series(45, 5, 2.6, [78, 82, 85, 88, 90]),
      crew_conflict: series(20, 4, 1.9),
    },
    sleep: series(62, 3, 1.0).map((v) => v / 10),
    levels: { WB_STRESS: { level: 'caution', sustained: 5 } },
    hour: 21,
  },
  LYRA: {
    values: {
      mood: series(64, 4, 0.9, [48, 42, 38, 35]),
      fatigue: series(48, 5, 2.2, [52, 54, 55]),
      stress: series(50, 5, 1.3),
      crew_conflict: series(25, 4, 0.4),
    },
    sleep: series(59, 3, 2.1).map((v) => v / 10),
    levels: { WB_MOOD: { level: 'caution', sustained: 4 } },
    hour: 22,
  },
  ATLAS: {
    values: {
      mood: series(70, 4, 2.4),
      fatigue: series(40, 4, 0.8),
      stress: series(35, 5, 1.6),
      crew_conflict: series(10, 3, 2.9),
    },
    sleep: series(72, 3, 1.7).map((v) => v / 10),
    levels: {},
    hour: 20,
  },
};

/** Inicio (00:00 UTC) del día de t0. */
const dayStart = (t0: number) => Math.floor(t0 / DAY) * DAY;

export function buildCheckins(t0: number, callSign: string): BehavioralCheckin[] {
  const profile = PROFILES[callSign];
  if (!profile) return [];
  // El último check-in es el de anoche (o el de hoy si ya pasó la hora).
  let last = dayStart(t0) + profile.hour * HOUR;
  if (last > t0) last -= DAY;
  return Array.from({ length: DAYS }, (_, i) => {
    const measured = last - (DAYS - 1 - i) * DAY;
    return {
      id: `a0000000-0000-4000-8000-${crewByCallSign(callSign).astronaut_id.slice(-3)}0000000${String(i).padStart(2, '0')}`,
      measured_at: iso(measured),
      received_at: iso(measured + 2_000),
      mood: profile.values.mood[i] ?? null,
      fatigue: profile.values.fatigue[i] ?? null,
      stress: profile.values.stress[i] ?? null,
      crew_conflict: profile.values.crew_conflict[i] ?? null,
      sleep_hours: profile.sleep[i] ?? null,
      supersedes_id: null,
    };
  });
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
};

/** Indicadores conductuales del detalle (z adversa de los últimos 3 días contra los anteriores). */
export function buildIndicators(t0: number, callSign: string): BehavioralIndicator[] {
  const profile = PROFILES[callSign];
  if (!profile) return [];
  const checkins = buildCheckins(t0, callSign);
  return SLIDERS.map(({ key, code, adverse }) => {
    const points = checkins.map((c) => ({ measured_at: c.measured_at, value: c[key] as number }));
    const values = points.map((p) => p.value);
    const baseline = values.slice(0, -3);
    const recent = values.slice(-3);
    const spread = sd(baseline) || 1;
    const diff = (mean(recent) - mean(baseline)) / spread;
    const z = Math.round((adverse === 'high' ? diff : -diff) * 10) / 10;
    const fixed = profile.levels[code];
    return {
      code,
      level: fixed?.level ?? 'normal',
      escalation: fixed ? 'behavioral_health' : 'self_care',
      last_value: values[values.length - 1] ?? null,
      adverse_z_3d: z,
      adverse_sustained_days: fixed?.sustained ?? 0,
      trend: trendOf(values),
      series: points,
    };
  });
}

export function buildScreenings(t0: number, callSign: string): Screening[] {
  const at = (hoursAgo: number) => iso(t0 - hoursAgo * HOUR);
  const id = (n: number) => `a4000000-0000-4000-8000-${crewByCallSign(callSign).astronaut_id.slice(-3)}00000000${n}`;
  const s = (n: number, instrument: 'PHQ2' | 'GAD2', i1: number, i2: number, level: Level, hoursAgo: number): Screening => ({
    id: id(n),
    instrument,
    score: i1 + i2,
    item_1: i1,
    item_2: i2,
    level,
    measured_at: at(hoursAgo),
  });
  switch (callSign) {
    case 'ORION':
      return [s(1, 'PHQ2', 0, 1, 'normal', 6 * 24 + 3), s(2, 'GAD2', 1, 1, 'normal', 6 * 24 + 3)];
    case 'VEGA':
      return [s(1, 'PHQ2', 1, 0, 'normal', 25), s(2, 'GAD2', 2, 2, 'caution', 25)];
    case 'LYRA':
      return [s(1, 'PHQ2', 2, 2, 'caution', 23), s(2, 'GAD2', 1, 1, 'normal', 23), s(3, 'PHQ2', 0, 1, 'normal', 8 * 24)];
    default:
      return [s(1, 'PHQ2', 0, 0, 'normal', 3 * 24 + 2), s(2, 'GAD2', 0, 1, 'normal', 3 * 24 + 2)];
  }
}

export function buildPvtRuns(t0: number, callSign: string): PvtRun[] {
  const tag = crewByCallSign(callSign).astronaut_id.slice(-3);
  const run = (n: number, hoursAgo: number, lapses: number, rt: number, fs: number, fitness: PvtRun['fitness'], critical = false): PvtRun => ({
    id: `a3000000-0000-4000-8000-${tag}00000000${n}`,
    measured_at: iso(t0 - hoursAgo * HOUR),
    lapses,
    mean_rt_ms: rt,
    false_starts: fs,
    before_critical_task: critical,
    fitness,
  });
  const base: Record<string, PvtRun[]> = {
    ORION: [run(1, 9 * 24 + 5, 1, 246, 0, 'fit'), run(2, 6 * 24 + 5, 2, 251, 0, 'fit'), run(3, 3 * 24 + 5, 1, 249, 1, 'fit'), run(4, 5, 2, 258, 0, 'fit', true)],
    VEGA: [run(1, 9 * 24 + 4, 2, 255, 0, 'fit'), run(2, 6 * 24 + 4, 2, 252, 0, 'fit'), run(3, 3 * 24 + 4, 3, 262, 0, 'fit'), run(4, 4, 3, 258, 0, 'fit')],
    LYRA: [run(1, 9 * 24 + 9, 1, 241, 0, 'fit'), run(2, 6 * 24 + 9, 2, 248, 0, 'fit'), run(3, 3 * 24 + 9, 4, 279, 1, 'fit'), run(4, 9, 9, 342, 2, 'not_confirmed', true)],
    ATLAS: [run(1, 9 * 24 + 7, 1, 238, 0, 'fit'), run(2, 6 * 24 + 7, 0, 235, 0, 'fit'), run(3, 3 * 24 + 7, 1, 240, 0, 'fit'), run(4, 7, 1, 237, 0, 'fit')],
  };
  return base[callSign] ?? [];
}

// ---------------------------------------------------------------- bandeja conductual

export interface MockSupportRequest extends SupportRequest {
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  closed_at?: string | null;
  closed_by?: string | null;
}

export interface MockBehavioralEscalation {
  id: string;
  astronaut_id: string;
  kind: 'wellbeing_alert' | 'screening_alert';
  indicator_code: string;
  priority: 'routine' | 'urgent';
  status: 'delivered' | 'acknowledged' | 'responded' | 'closed';
  summary: string;
  created_at: string;
  measured_at: string;
  deliver_at: string;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  closed_at?: string | null;
  closed_by?: string | null;
}

export function buildSupportRequests(t0: number): MockSupportRequest[] {
  const bh = groundUser('behavioral_health');
  const req = (
    n: number,
    callSign: string,
    urgency: SupportRequest['urgency'],
    channel: SupportRequest['channel'],
    content: string,
    createdMs: number,
    extra: Partial<MockSupportRequest> = {},
  ): MockSupportRequest => ({
    id: `a1000000-0000-4000-8000-00000000000${n}`,
    client_uuid: `cd000000-0000-4000-8000-00000000000${n}`,
    astronaut_id: crewByCallSign(callSign).astronaut_id,
    status: 'open',
    urgency,
    channel,
    content,
    created_at: iso(createdMs),
    received_at: iso(createdMs + 2_000),
    deliver_at: iso(createdMs + DELAY_S * 1000),
    ...extra,
  });
  return [
    req(1, 'ORION', 'today', 'message', 'Llevo varios días durmiendo mal y me cuesta concentrarme.', t0 - 40 * MINUTE),
    req(2, 'LYRA', 'now', 'message', 'Hoy me siento muy aislada y no logro concentrarme. ¿Podemos hablar?', t0 - 8 * MINUTE),
    req(3, 'ATLAS', 'later', 'session', 'Me gustaría una sesión esta semana para hablar de la rutina de sueño.', t0 - 26 * HOUR, {
      status: 'acknowledged',
      acknowledged_at: iso(t0 - 25 * HOUR),
      acknowledged_by: bh.id,
    }),
    // Todavía viaja a Tierra: aparece en la bandeja ~2,5 min después de abrir el demo.
    req(4, 'VEGA', 'today', 'message', 'Quiero comentar algo sobre la convivencia en el módulo.', t0 + 60_000),
    req(5, 'ORION', 'later', 'message', 'Necesitaba hablar de la carga de trabajo de la semana.', t0 - 6 * DAY, {
      status: 'closed',
      acknowledged_at: iso(t0 - 6 * DAY + HOUR),
      acknowledged_by: bh.id,
      closed_at: iso(t0 - 5 * DAY),
      closed_by: bh.id,
    }),
  ];
}

export function buildBehavioralEscalations(t0: number): MockBehavioralEscalation[] {
  const bh = groundUser('behavioral_health');
  const esc = (
    id: string,
    callSign: string,
    kind: MockBehavioralEscalation['kind'],
    code: string,
    priority: MockBehavioralEscalation['priority'],
    summary: string,
    createdMs: number,
    extra: Partial<MockBehavioralEscalation> = {},
  ): MockBehavioralEscalation => ({
    id,
    astronaut_id: crewByCallSign(callSign).astronaut_id,
    kind,
    indicator_code: code,
    priority,
    status: 'delivered',
    summary,
    created_at: iso(createdMs),
    measured_at: iso(createdMs - 2 * MINUTE),
    deliver_at: iso(createdMs + DELAY_S * 1000),
    ...extra,
  });
  return [
    esc('60000000-0000-4000-8000-000000000221', 'VEGA', 'wellbeing_alert', 'WB_STRESS', 'routine', 'Estrés distinto de lo habitual durante 5 check-ins seguidos', t0 - 14 * HOUR),
    esc('60000000-0000-4000-8000-000000000222', 'LYRA', 'screening_alert', 'PHQ2_SCORE', 'urgent', 'Tamizaje de ánimo (PHQ-2) positivo', t0 - 23 * HOUR, {
      status: 'acknowledged',
      acknowledged_at: iso(t0 - 22 * HOUR),
      acknowledged_by: bh.id,
    }),
    esc('60000000-0000-4000-8000-000000000223', 'LYRA', 'wellbeing_alert', 'WB_MOOD', 'urgent', 'Ánimo distinto de lo habitual durante 4 check-ins seguidos', t0 - 2 * HOUR),
    esc('60000000-0000-4000-8000-000000000224', 'ORION', 'wellbeing_alert', 'WB_FATIGUE', 'routine', 'Fatiga distinta de lo habitual durante 3 check-ins seguidos', t0 - 5 * DAY, {
      status: 'closed',
      acknowledged_at: iso(t0 - 5 * DAY + HOUR),
      acknowledged_by: bh.id,
      closed_at: iso(t0 - 3 * DAY),
      closed_by: bh.id,
    }),
  ];
}

/** Accesos confidenciales previos (la bitácora crece con cada consulta en el demo). */
export function buildAudit(t0: number): ConfidentialAccess[] {
  const bh = groundUser('behavioral_health');
  const entry = (n: number, callSign: string, resource: string, hoursAgo: number): ConfidentialAccess => {
    const member = crewByCallSign(callSign);
    return {
      id: `b2000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
      actor_user_id: bh.id,
      actor_username: bh.username,
      actor_role: 'behavioral_health',
      astronaut_id: member.astronaut_id,
      call_sign: member.call_sign,
      resource,
      accessed_at: iso(t0 - hoursAgo * HOUR),
    };
  };
  const INBOX = 'GET /api/v1/admin/behavioral/inbox';
  const DETAIL = 'GET /api/v1/admin/behavioral/astronauts/{id}';
  return [
    entry(1, 'LYRA', DETAIL, 22),
    entry(2, 'LYRA', INBOX, 22.1),
    entry(3, 'VEGA', INBOX, 22.1),
    entry(4, 'ATLAS', INBOX, 25),
    entry(5, 'ATLAS', DETAIL, 25),
    entry(6, 'ORION', DETAIL, 3 * 24),
  ];
}
