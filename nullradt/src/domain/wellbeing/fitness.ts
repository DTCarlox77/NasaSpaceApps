/**
 * Aptitud para tarea crítica a partir de la prueba de reacción INSPIRADA en la PVT-B
 * (Basner, Mollicone & Dinges, 2011: 3 min, intervalos de 1–4 s, lapso ≥ 355 ms, salida en falso < 100 ms).
 * No es el software validado de NASA. El criterio de aptitud es configurable por el flight surgeon:
 * se compara contra la línea base PERSONAL y del MISMO dispositivo (las pantallas tienen latencias distintas).
 */
export const PVTB = { durationSec: 180, demoDurationSec: 30, isiMinMs: 1000, isiMaxMs: 4000, lapseMs: 355, falseStartMs: 100 } as const;

export interface PvtSummary {
  meanRt: number;
  lapses: number;
  falseStarts: number;
  responses: number;
  durationSec: number;
  deviceId: string;
}

export const FITNESS_CRITERIA = {
  /** Pruebas previas necesarias en el mismo dispositivo y duración. */
  minBaseline: 3,
  /** Margen sobre la media personal: el mayor entre 2 DE y 10 %. */
  sdFactor: 2,
  minMarginPct: 0.1,
  extraLapses: 2,
} as const;

export function evaluateFitness(current: PvtSummary, previous: PvtSummary[]): 'yes' | 'notConfirmed' | 'baseline' {
  const base = previous.filter((p) => p.deviceId === current.deviceId && p.durationSec === current.durationSec).slice(-10);
  if (base.length < FITNESS_CRITERIA.minBaseline) return 'baseline';
  const mean = base.reduce((a, p) => a + p.meanRt, 0) / base.length;
  const sd = Math.sqrt(base.reduce((a, p) => a + (p.meanRt - mean) ** 2, 0) / base.length);
  const lapses = base.reduce((a, p) => a + p.lapses, 0) / base.length;
  const margin = Math.max(FITNESS_CRITERIA.sdFactor * sd, FITNESS_CRITERIA.minMarginPct * mean);
  const ok = current.meanRt <= mean + margin && current.lapses <= Math.ceil(lapses) + FITNESS_CRITERIA.extraLapses;
  return ok ? 'yes' : 'notConfirmed';
}
