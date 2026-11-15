import type { HealthIndicator, HealthStatus, MeasurementSource } from '../entities/HealthIndicator';
import { classify } from '../rules/ruleEngine';
import type { Sex } from '../rules/sexReference';

/** Punto de la serie temporal de un indicador. */
export interface HistoryPoint {
  at: number; // epoch ms
  value: number;
  secondary?: number;
  status: HealthStatus;
  source: MeasurementSource;
  synthetic: boolean;
  photoUri?: string;
}

export interface LocalReadingLike {
  indicatorId: string;
  status: HealthStatus;
  reading: { value: number; secondaryValue?: number; takenAt: string; source?: MeasurementSource; photoUri?: string };
}

/** PRNG determinista (mulberry32): la misma serie sintética en cada arranque. */
function rng(seedText: string) {
  let seed = 0;
  for (const ch of seedText) seed = (Math.imul(seed ^ ch.charCodeAt(0), 2654435761) >>> 0) || 1;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const roundLike = (sample: number, v: number) => (Number.isInteger(sample) ? Math.round(v) : Math.round(v * 10) / 10);

/**
 * Serie histórica de un indicador:
 * 1) SINTÉTICA (marcada como tal): la tendencia de la maqueta + puntos anteriores generados alrededor
 *    del rango personal, cada `frequencyHours`, hasta cubrir `days` días.
 * 2) Mediciones reales tomadas en el dispositivo (manual, cámara o equipo simulado).
 */
export function buildHistory(ind: HealthIndicator, local: LocalReadingLike[], userId: string, days = 30, sex?: Sex): HistoryPoint[] {
  const points: HistoryPoint[] = [];
  const end = ind.latest ? new Date(ind.latest.takenAt).getTime() : Date.now();
  const stepMs = Math.max(ind.frequencyHours, 12) * 3_600_000;
  const total = Math.min(Math.floor((days * 86_400_000) / stepMs) + 1, 40);
  const trend = ind.trend.length ? ind.trend : ind.latest ? [ind.latest.value] : [];

  if (trend.length) {
    const rand = rng(`${userId}:${ind.id}`);
    const center = ind.personalRange ? (ind.personalRange.min + ind.personalRange.max) / 2 : trend.reduce((a, b) => a + b, 0) / trend.length;
    const spread = ind.personalRange ? (ind.personalRange.max - ind.personalRange.min) / 2 : Math.abs(center) * 0.05 || 1;
    const sample = trend[0]!;
    const values: number[] = [];
    for (let i = 0; i < total - trend.length; i++) values.push(roundLike(sample, center + (rand() * 2 - 1) * spread * 0.8));
    values.push(...trend);
    const series = values.slice(-total);
    series.forEach((value, i) => {
      const at = end - (series.length - 1 - i) * stepMs;
      const secondary = ind.id === 'bloodPressure' ? (i === series.length - 1 && ind.latest?.secondaryValue) || Math.round(value * 0.64) : undefined;
      const prev = series.slice(Math.max(0, i - 7), i);
      const status = i === series.length - 1 && ind.status ? ind.status : classify(ind.id, value, secondary, prev, sex).status;
      points.push({ at, value, secondary, status, source: ind.latest?.source ?? 'wearable', synthetic: true });
    });
  }

  for (const l of local) {
    if (l.indicatorId !== ind.id) continue;
    points.push({
      at: new Date(l.reading.takenAt).getTime(),
      value: l.reading.value,
      secondary: l.reading.secondaryValue,
      status: l.status,
      source: l.reading.source ?? 'wearable',
      synthetic: false,
      photoUri: l.reading.photoUri,
    });
  }
  return points.sort((a, b) => a.at - b.at);
}

/** ¿Cuándo toca la próxima medición? (frecuencia del protocolo desde la última). */
export function nextDueAt(ind: HealthIndicator, lastAt?: number): number | null {
  const last = lastAt ?? (ind.latest ? new Date(ind.latest.takenAt).getTime() : undefined);
  return last === undefined ? null : last + ind.frequencyHours * 3_600_000;
}
