import type { SourceRef } from '../entities/Hazard';
import type { HealthStatus, IndicatorId } from '../entities/HealthIndicator';

/**
 * Medición SIMULADA para la demo sin backend ni equipos reales.
 * Las reglas de clasificación NO se inventan: usan umbrales publicados y citados
 * (NEWS2 del Royal College of Physicians y categorías de presión arterial de la AHA).
 * Es una herramienta de apoyo a la decisión, no un diagnóstico.
 */

export const NEWS2: SourceRef = {
  title: 'National Early Warning Score (NEWS) 2 — Royal College of Physicians, 2017',
  url: 'https://www.rcp.ac.uk/improving-care/resources/national-early-warning-score-news-2/',
};
export const AHA_BP: SourceRef = {
  title: 'Understanding Blood Pressure Readings — American Heart Association',
  url: 'https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings',
};

export type MeasurableId = Extract<IndicatorId, 'bloodPressure' | 'heartRate' | 'spo2' | 'bodyTemperature' | 'respRate'>;
export const MEASURABLE: MeasurableId[] = ['bloodPressure', 'heartRate', 'spo2', 'bodyTemperature', 'respRate'];
export const isMeasurable = (id: IndicatorId): id is MeasurableId => (MEASURABLE as IndicatorId[]).includes(id);

export interface SimulatedReading {
  value: number;
  secondaryValue?: number;
  status: Exclude<HealthStatus, 'unevaluated'>;
  source: SourceRef;
}

/** Equipo simulado para cada indicador (clave i18n `measure.devices.*`). */
export const DEVICE: Record<MeasurableId, 'bpCuff' | 'pulseOximeter' | 'thermometer' | 'respBand'> = {
  bloodPressure: 'bpCuff',
  heartRate: 'pulseOximeter',
  spo2: 'pulseOximeter',
  bodyTemperature: 'thermometer',
  respRate: 'respBand',
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const int = (min: number, max: number) => Math.round(rand(min, max));
const pick = <T,>(...xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;

/** NEWS2: puntuación 0 → normal · 1–2 → precaución · 3 → crítico. */
const fromScore = (score: number): SimulatedReading['status'] => (score >= 3 ? 'critical' : score >= 1 ? 'caution' : 'normal');

export function classify(id: MeasurableId, value: number, secondary?: number): SimulatedReading['status'] {
  switch (id) {
    case 'heartRate':
      return fromScore(value <= 40 || value >= 131 ? 3 : value >= 111 ? 2 : value <= 50 || value >= 91 ? 1 : 0);
    case 'spo2':
      return fromScore(value <= 91 ? 3 : value <= 93 ? 2 : value <= 95 ? 1 : 0);
    case 'respRate':
      return fromScore(value <= 8 || value >= 25 ? 3 : value >= 21 ? 2 : value <= 11 ? 1 : 0);
    case 'bodyTemperature':
      return fromScore(value <= 35 ? 3 : value >= 39.1 ? 2 : value <= 36 || value >= 38.1 ? 1 : 0);
    case 'bloodPressure': {
      const dia = secondary ?? 0;
      // Crisis hipertensiva (AHA) o sistólica ≤ 90 (NEWS2 = 3) → crítico.
      if (value > 180 || dia > 120 || value <= 90) return 'critical';
      // Elevada / hipertensión (AHA) o sistólica 91–110 (NEWS2 1–2) → precaución.
      if (value >= 120 || dia >= 80 || value <= 110) return 'caution';
      return 'normal';
    }
  }
}

/** Genera una lectura aleatoria: ~75 % normal, ~17 % precaución, ~8 % crítica. */
export function simulateMeasurement(id: MeasurableId): SimulatedReading {
  const roll = Math.random();
  const band = roll < 0.75 ? 'normal' : roll < 0.92 ? 'caution' : 'critical';
  let value: number;
  let secondaryValue: number | undefined;

  switch (id) {
    case 'heartRate':
      value = band === 'normal' ? int(56, 88) : band === 'caution' ? pick(int(92, 118), int(44, 50)) : pick(int(132, 150), int(34, 40));
      break;
    case 'spo2':
      value = band === 'normal' ? int(96, 99) : band === 'caution' ? int(92, 95) : int(85, 91);
      break;
    case 'respRate':
      value = band === 'normal' ? int(12, 20) : band === 'caution' ? pick(int(21, 24), int(9, 11)) : pick(int(25, 30), int(6, 8));
      break;
    case 'bodyTemperature':
      value = +(band === 'normal' ? rand(36.2, 37.6) : band === 'caution' ? pick(rand(38.2, 39), rand(35.4, 35.9)) : pick(rand(39.2, 40.2), rand(34.2, 34.9))).toFixed(1);
      break;
    case 'bloodPressure':
      if (band === 'normal') {
        value = int(111, 119);
        secondaryValue = int(66, 78);
      } else if (band === 'caution') {
        value = int(122, 145);
        secondaryValue = int(80, 92);
      } else {
        value = pick(int(182, 196), int(76, 88));
        secondaryValue = value > 150 ? int(110, 124) : int(44, 54);
      }
      break;
  }
  return { value, secondaryValue, status: classify(id, value, secondaryValue), source: id === 'bloodPressure' ? AHA_BP : NEWS2 };
}
