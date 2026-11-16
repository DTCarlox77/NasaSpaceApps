import type { HazardId } from '@/domain/entities/Hazard';
import type { BodySystemId, EscalationLevel, HealthStatus, IndicatorId } from '@/domain/entities/HealthIndicator';
import type { ApiEscalationLevel, ApiLevel } from '../datasources/remote/apiTypes';

/**
 * Tabla de mapeo app ↔ catálogo del servidor (GET /indicators, catalog_version 1, verificado contra la
 * API desplegada). Documentada en INTEGRACION.md. Si el catálogo cambia, manda el servidor: se ajusta aquí.
 *
 * Indicadores de la app SIN código en el catálogo (quedan en el dispositivo, "sin evaluar"):
 * eyePressure (presión ocular), urinaryCalcium (calcio urinario), gripStrength (fuerza de agarre) y
 * reactionTime (el PVT es confidencial: va por POST /wellbeing/pvt-runs y nunca entra al semáforo).
 */
export const INDICATOR_CODE: Partial<Record<IndicatorId, string>> = {
  heartRate: 'HEART_RATE',
  bloodPressure: 'BLOOD_PRESSURE',
  spo2: 'SPO2',
  respRate: 'RESP_RATE',
  bodyTemperature: 'BODY_TEMP',
  glucose: 'GLUCOSE',
  sleepHours: 'SLEEP_HOURS',
  radDoseDaily: 'RAD_DOSE_DAILY',
  radDoseCum: 'RAD_DOSE_CUM',
  bodyMass: 'BODY_MASS',
  exerciseMin: 'EXERCISE_MIN',
  visionCheck: 'VISION_CHECK',
  symptoms: 'SYMPTOM',
};

export const INDICATOR_FROM_CODE: Record<string, IndicatorId> = Object.fromEntries(
  Object.entries(INDICATOR_CODE).map(([id, code]) => [code, id as IndicatorId]),
);

/** Indicadores que solo existen en el dispositivo (sin endpoint ni umbral del servidor). */
export const LOCAL_ONLY_INDICATORS: IndicatorId[] = ['eyePressure', 'urinaryCalcium', 'gripStrength', 'reactionTime'];

/** Zonas del servidor (GET /body-zones) ↔ sistemas de la figura. `environment` es tarjeta aparte; `by_symptom` usa la zona de cada síntoma. */
export const SYSTEM_FROM_ZONE: Record<string, BodySystemId> = {
  heart: 'cardiovascular',
  lungs: 'respiratory',
  brain: 'brain',
  eyes: 'eyes',
  bones: 'skeletal',
  muscle: 'muscular',
  immune: 'immune',
  metabolism: 'metabolism',
};

export const ZONE_FROM_SYSTEM: Record<BodySystemId, string> = Object.fromEntries(
  Object.entries(SYSTEM_FROM_ZONE).map(([zone, sys]) => [sys, zone]),
) as Record<BodySystemId, string>;

/** Niveles del servidor ↔ estados de la app. `unrated` (sin evaluar) nunca se muestra como "bien". */
export const STATUS_FROM_LEVEL: Record<ApiLevel, HealthStatus> = {
  normal: 'normal',
  caution: 'caution',
  critical: 'critical',
  unrated: 'unevaluated',
};

export const ESCALATION_FROM_API: Record<ApiEscalationLevel, EscalationLevel> = {
  self_care: 'self',
  crew: 'crew',
  flight_surgeon: 'flightSurgeon',
  // Solo indicadores confidenciales; la app no los muestra en el semáforo.
  behavioral_health: 'self',
};

/** Peligros RIDGE del servidor ↔ ids de la app. */
export const HAZARD_FROM_API: Record<string, HazardId> = {
  space_radiation: 'radiation',
  isolation_confinement: 'isolation',
  distance_from_earth: 'distance',
  gravity_fields: 'gravity',
  hostile_closed_env: 'environment',
};

/**
 * Síntomas del check-in de la app ↔ códigos de GET /symptoms. `congestion` e `insomnia` no existen en el
 * catálogo: se quedan en el dispositivo (el sueño va por SLEEP_HOURS); `none` no se envía.
 */
export const SYMPTOM_CODE: Record<string, string | null> = {
  headache: 'headache',
  nausea: 'nausea',
  backPain: 'back_pain',
  blurredVision: 'blurred_vision',
  fatigue: 'fatigue',
  congestion: null,
  insomnia: null,
  none: null,
};

/**
 * `input_method` por indicador para la pantalla Medir (debe estar en `input_methods` del catálogo):
 * la app usa el sensor simulado ('wearable') donde el catálogo lo permite; si no, 'manual'.
 */
export function inputMethodFor(allowed: string[] | undefined, preferred: 'wearable' | 'manual'): string {
  if (!allowed?.length) return preferred;
  if (allowed.includes(preferred)) return preferred;
  return allowed.includes('manual') ? 'manual' : allowed[0]!;
}
