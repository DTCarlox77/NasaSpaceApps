import type { HazardId, SourceRef } from './Hazard';

/** Sistemas del cuerpo del mapa interactivo (Figma). */
export type BodySystemId = 'cardiovascular' | 'respiratory' | 'brain' | 'eyes' | 'skeletal' | 'muscular' | 'immune';

export type IndicatorId =
  | 'heartRate'
  | 'bloodPressure'
  | 'spo2'
  | 'respRate'
  | 'reactionTime'
  | 'eyePressure'
  | 'urinaryCalcium'
  | 'gripStrength'
  | 'bodyTemperature';

/** Semáforo. 'unevaluated' = registrado pero sin regla validada a bordo (no se inventan umbrales). */
export type HealthStatus = 'normal' | 'caution' | 'critical' | 'unevaluated';

/** Escalamiento: autocuidado → tripulación → flight surgeon. */
export type EscalationLevel = 'self' | 'crew' | 'flightSurgeon';

/**
 * Rango de referencia. `source` es obligatorio: ningún umbral entra
 * a la app sin cita (regla del proyecto: no inventar cifras médicas).
 * Lo provee el backend junto con cada indicador.
 */
export interface ReferenceRange {
  normal: { min?: number; max?: number };
  caution: { min?: number; max?: number };
  source: SourceRef;
}

export type MeasurementSource = 'wearable' | 'manual' | 'camera';

export interface Reading {
  value: number;
  /** Segundo valor (p. ej. diastólica en presión arterial). */
  secondaryValue?: number;
  takenAt: string; // ISO 8601
  missionDay?: number;
  source: MeasurementSource;
  /** false = guardado solo en el dispositivo, pendiente de sincronizar. */
  synced: boolean;
  /** Foto del equipo de medición (entrada por cámara), guardada en el dispositivo. */
  photoUri?: string;
  note?: string;
}

/**
 * Indicador de salud tal como lo entrega el backend (o el mock).
 * El estado lo calcula el backend con reglas validadas; la app lo muestra y explica.
 */
export interface HealthIndicator {
  id: IndicatorId;
  systemId: BodySystemId;
  unit: string;
  hazards: HazardId[];
  status: HealthStatus;
  latest?: Reading;
  range?: ReferenceRange;
  personalRange?: { min: number; max: number };
  /** Últimos valores para la mini-gráfica (más antiguo → más reciente). */
  trend: number[];
  /** Tiempo entre mediciones programadas. */
  frequencyHours: number;
  synthetic: boolean;
}

export interface Measurement {
  id: string;
  indicatorId: IndicatorId;
  value: number;
  takenAt: string; // ISO 8601
  input: 'text' | 'tap' | 'camera' | 'device';
  /** Toda medición de la demo es sintética y se marca como tal. */
  synthetic: boolean;
}
