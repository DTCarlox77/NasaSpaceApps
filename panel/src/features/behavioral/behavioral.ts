/**
 * Lógica de Salud conductual (sin React, para probarla sola). CONFIDENCIAL: solo
 * behavioral_health. Apoyo a la decisión, no diagnóstico: niveles, z y aptitud vienen de la API.
 * - La nota privada del check-in NUNCA se muestra: screenBehavioralDetail() deja solo los campos
 *   conocidos (si la API mandara una nota, se descarta).
 * - PHQ-2 / GAD-2: solo positivo/negativo (según el `level` de la API) y la fecha; nunca el puntaje.
 * - Rango habitual de los deslizadores y línea base de la PVT: el contrato no los manda; el panel
 *   los estima de los propios datos de la persona y lo dice en pantalla.
 */
import type {
  BehavioralAstronautDetail,
  BehavioralCheckin,
  BehavioralInboxItem,
  Level,
  PvtRun,
  Screening,
  SeriesPoint,
  SupportRequest,
  SupportUrgency,
} from '../../api/types.ts';

export const CONFIDENTIAL_TEXT =
  'Confidencial · cada consulta queda registrada · apoyo a la decisión, no diagnóstico';

export const INBOX_POLL_MS = 30_000;
export const DETAIL_POLL_MS = 60_000;
export const AUDIT_POLL_MS = 30_000;

// ---------------------------------------------------------------- bandeja

export const URGENCY_META: Record<SupportUrgency, { icon: string; text: string; tone: string }> = {
  now: { icon: '■', text: 'Ahora', tone: 'emergency' },
  today: { icon: '▲', text: 'Hoy', tone: 'urgent' },
  later: { icon: '●', text: 'Puede esperar', tone: 'routine' },
};

export const KIND_LABELS: Record<BehavioralInboxItem['kind'], string> = {
  support_request: '"Quiero hablar con alguien"',
  wellbeing_alert: 'Alerta de bienestar',
  screening_alert: 'Tamizaje',
};

export const CHANNEL_LABELS: Record<'message' | 'session', string> = {
  message: 'por mensaje',
  session: 'pide una sesión',
};

export const STATUS_LABELS: Record<string, string> = {
  open: 'Sin acuse',
  delivered: 'Sin acuse',
  acknowledged: 'Con acuse',
  responded: 'Respondida',
  closed: 'Cerrada',
};

export const INDICATOR_LABELS: Record<string, string> = {
  WB_MOOD: 'Ánimo',
  WB_FATIGUE: 'Fatiga',
  WB_STRESS: 'Estrés',
  WB_CREW_CONFLICT: 'Roces con la tripulación',
  PHQ2_SCORE: 'Tamizaje de ánimo (PHQ-2)',
  GAD2_SCORE: 'Tamizaje de ansiedad (GAD-2)',
  PVT_LAPSES: 'Prueba de reacción: lapsos',
  PVT_MEAN_RT: 'Prueba de reacción: tiempo medio',
  PVT_FALSE_STARTS: 'Prueba de reacción: falsos inicios',
};

export const indicatorLabel = (code: string | null | undefined): string =>
  code ? (INDICATOR_LABELS[code] ?? code) : '';

// ---------------------------------------------------------------- deslizadores

/** Los 4 deslizadores del check-in, en el orden de la pantalla. */
export const SLIDERS = [
  { code: 'WB_MOOD', key: 'mood', label: 'Ánimo', adverse: 'bajar' },
  { code: 'WB_FATIGUE', key: 'fatigue', label: 'Fatiga', adverse: 'subir' },
  { code: 'WB_STRESS', key: 'stress', label: 'Estrés', adverse: 'subir' },
  { code: 'WB_CREW_CONFLICT', key: 'crew_conflict', label: 'Roces con la tripulación', adverse: 'subir' },
] as const;

export interface UsualRange {
  low: number;
  high: number;
  mean: number;
  /** Puntos usados para estimarlo. */
  points: number;
}

/** Puntos que necesita el panel para estimar el rango habitual. */
export const MIN_BASELINE_POINTS = 5;
/** Días recientes que no entran en el rango habitual (se comparan contra él). */
export const RECENT_POINTS = 3;

/**
 * Rango habitual estimado por el panel: media ± 1 desviación estándar de los check-ins
 * anteriores a los últimos 3 (escala 0–100). null si no hay al menos 5 puntos de base.
 */
export function usualRange(series: SeriesPoint[]): UsualRange | null {
  const sorted = [...series].sort((a, b) => a.measured_at.localeCompare(b.measured_at));
  const base = sorted.slice(0, Math.max(0, sorted.length - RECENT_POINTS)).map((p) => p.value);
  if (base.length < MIN_BASELINE_POINTS) return null;
  const mean = base.reduce((a, b) => a + b, 0) / base.length;
  const sd = Math.sqrt(base.reduce((a, b) => a + (b - mean) ** 2, 0) / (base.length - 1));
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  return { low: clamp(mean - sd), high: clamp(mean + sd), mean: Math.round(mean), points: base.length };
}

const zFormat = new Intl.NumberFormat('es', { maximumFractionDigits: 1, minimumFractionDigits: 1, signDisplay: 'exceptZero' });

/** "z adversa (3 días): +2,1" o "sin z" (la calcula la API). */
export function zLabel(z: number | null | undefined): string {
  return typeof z === 'number' ? `z adversa (3 días): ${zFormat.format(z)}` : 'z adversa: sin dato';
}

// ---------------------------------------------------------------- tamizajes y PVT

export const INSTRUMENT_LABELS: Record<Screening['instrument'], string> = {
  PHQ2: 'PHQ-2 (ánimo)',
  GAD2: 'GAD-2 (ansiedad)',
};

/** Positivo/negativo según el nivel de la API (nunca el puntaje). */
export function screeningResult(level: Level): { text: string; icon: string; positive: boolean | null } {
  if (level === 'caution' || level === 'critical') return { text: 'Positivo', icon: '▲', positive: true };
  if (level === 'normal') return { text: 'Negativo', icon: '●', positive: false };
  return { text: 'Sin evaluar', icon: '○', positive: null };
}

export const FITNESS_TEXT: Record<PvtRun['fitness'], string> = {
  fit: 'Apto para tarea crítica',
  not_confirmed: 'Aptitud no confirmada',
};

export interface PvtComparison {
  latest: PvtRun;
  /** Media del tiempo de reacción de las corridas anteriores (línea base del panel). */
  baselineMs: number | null;
  baselineRuns: number;
  /** Diferencia con la línea base (ms); positivo = más lento. */
  deltaMs: number | null;
}

/** Última PVT frente a la media de las anteriores (cálculo del panel, el contrato no la manda). */
export function comparePvt(runs: PvtRun[]): PvtComparison | null {
  const sorted = [...runs].sort((a, b) => a.measured_at.localeCompare(b.measured_at));
  const latest = sorted[sorted.length - 1];
  if (!latest) return null;
  const previous = sorted.slice(0, -1);
  if (previous.length === 0) return { latest, baselineMs: null, baselineRuns: 0, deltaMs: null };
  const baseline = Math.round(previous.reduce((a, r) => a + r.mean_rt_ms, 0) / previous.length);
  return { latest, baselineMs: baseline, baselineRuns: previous.length, deltaMs: Math.round(latest.mean_rt_ms - baseline) };
}

export function deltaLabel(cmp: PvtComparison): string {
  if (cmp.baselineMs === null || cmp.deltaMs === null) return 'Sin corridas anteriores para comparar.';
  const n = cmp.baselineRuns;
  const ref = `su promedio de ${n === 1 ? 'la corrida anterior' : `las ${n} anteriores`} (${cmp.baselineMs} ms)`;
  if (cmp.deltaMs === 0) return `Igual que ${ref}.`;
  return `${Math.abs(cmp.deltaMs)} ms ${cmp.deltaMs > 0 ? 'más lento' : 'más rápido'} que ${ref}.`;
}

// ---------------------------------------------------------------- lo que nunca se muestra

const CHECKIN_FIELDS = ['id', 'measured_at', 'received_at', 'mood', 'fatigue', 'stress', 'crew_conflict', 'sleep_hours', 'supersedes_id'] as const;
const SUPPORT_FIELDS = ['id', 'client_uuid', 'astronaut_id', 'status', 'urgency', 'channel', 'content', 'created_at', 'received_at', 'deliver_at'] as const;

function pick<T extends object, K extends readonly string[]>(source: T, keys: K): { value: T; dropped: number } {
  const value = {} as Record<string, unknown>;
  for (const key of keys) {
    if (key in source) value[key] = (source as Record<string, unknown>)[key];
  }
  const dropped = Object.keys(source).filter((k) => !keys.includes(k)).length;
  return { value: value as T, dropped };
}

export interface ScreenedBehavioralDetail {
  detail: BehavioralAstronautDetail;
  /** Campos descartados (p. ej. una nota privada que no debía venir). */
  dropped: number;
}

/**
 * Deja solo los campos conocidos de los check-ins y las solicitudes. La nota privada del
 * check-in solo la ve el astronauta: si la API la mandara, aquí se descarta.
 */
export function screenBehavioralDetail(detail: BehavioralAstronautDetail): ScreenedBehavioralDetail {
  let dropped = 0;
  const checkins = (Array.isArray(detail.checkins) ? detail.checkins : []).map((c) => {
    const result = pick<BehavioralCheckin, typeof CHECKIN_FIELDS>(c, CHECKIN_FIELDS);
    dropped += result.dropped;
    return result.value;
  });
  const supportRequests = (Array.isArray(detail.support_requests) ? detail.support_requests : []).map((r) => {
    const result = pick<SupportRequest, typeof SUPPORT_FIELDS>(r, SUPPORT_FIELDS);
    // `suggestions` es del contrato (solo al crearla): no se muestra, pero no cuenta como descarte.
    dropped += result.dropped - ('suggestions' in r ? 1 : 0);
    return result.value;
  });
  return {
    detail: {
      ...detail,
      indicators: Array.isArray(detail.indicators) ? detail.indicators : [],
      screenings: Array.isArray(detail.screenings) ? detail.screenings : [],
      pvt_runs: Array.isArray(detail.pvt_runs) ? detail.pvt_runs : [],
      escalations: Array.isArray(detail.escalations) ? detail.escalations : [],
      checkins,
      support_requests: supportRequests,
    },
    dropped,
  };
}
