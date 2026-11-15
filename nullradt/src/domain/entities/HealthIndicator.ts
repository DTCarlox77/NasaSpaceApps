import type { HazardId, SourceRef } from './Hazard';

/**
 * Sistemas del cuerpo del mapa interactivo (Figma). `metabolism` existe en el catálogo del servidor
 * (zona `metabolism`, glucosa) pero no tiene región en la figura: aparece como chip y en las listas.
 */
export type BodySystemId = 'cardiovascular' | 'respiratory' | 'brain' | 'eyes' | 'skeletal' | 'muscular' | 'immune' | 'metabolism';

export type IndicatorId =
  // Con código en el catálogo del servidor (ver `data/mappers/catalogMap.ts`).
  | 'heartRate'
  | 'bloodPressure'
  | 'spo2'
  | 'respRate'
  | 'bodyTemperature'
  | 'glucose'
  | 'sleepHours'
  | 'radDoseDaily'
  | 'radDoseCum'
  | 'bodyMass'
  | 'exerciseMin'
  | 'visionCheck'
  | 'symptoms'
  // Solo en el dispositivo: el catálogo no los tiene (o son confidenciales) → siempre "sin evaluar" con API.
  | 'reactionTime'
  | 'eyePressure'
  | 'urinaryCalcium'
  | 'gripStrength';

/** Semáforo. 'unevaluated' = registrado pero sin regla validada a bordo (no se inventan umbrales). */
export type HealthStatus = 'normal' | 'caution' | 'critical' | 'unevaluated';

/** Escalamiento: autocuidado → tripulación → flight surgeon. */
export type EscalationLevel = 'self' | 'crew' | 'flightSurgeon';

/**
 * Rango de referencia. `source` es obligatorio: ningún umbral entra
 * a la app sin cita (regla del proyecto: no inventar cifras médicas).
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
  /** Cómo se tomó; el estado del servidor (GET /me/body-status) no lo trae. */
  source?: MeasurementSource;
  /** false = guardado solo en el dispositivo, pendiente de sincronizar. */
  synced: boolean;
  /** true = nivel calculado en el dispositivo sin conexión (reglas del servidor), pendiente de confirmar. */
  provisional?: boolean;
}

/**
 * Indicador de salud tal como lo muestra la app (servidor, caché o maqueta).
 * Con API, `status` y `recommendation` los calcula el servidor con sus reglas citadas; la app solo los muestra.
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
  /** Código del catálogo del servidor (p. ej. HEART_RATE). */
  code?: string;
  /** Recomendación del servidor: se muestra tal cual. */
  recommendation?: string | null;
  /** Fuentes de las reglas del servidor (GET /indicators). */
  sources?: SourceRef[];
  /** A quién escala la regla vigente. */
  escalation?: EscalationLevel;
  /** true = el catálogo del servidor no lo tiene: solo vive en el dispositivo y queda "sin evaluar". */
  localOnly?: boolean;
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

/** Nivel del servidor → estado de la app. `unrated` (sin evaluar) nunca se muestra como "bien". */
export function statusFromServerLevel(level: string | undefined | null): HealthStatus {
  return level === 'normal' || level === 'caution' || level === 'critical' ? level : 'unevaluated';
}

/** Clave única de un indicador en listas (SYMPTOM puede aparecer en varias zonas). */
export const indicatorKey = (i: Pick<HealthIndicator, 'id' | 'systemId'>) => `${i.systemId}:${i.id}`;
