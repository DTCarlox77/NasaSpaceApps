import type { BodySystemId, HealthIndicator, HealthStatus, IndicatorId } from './HealthIndicator';

/**
 * Qué indicadores pertenecen a cada sistema y en qué orden se listan. Los textos viven en i18n.
 * Con API, el sistema de cada indicador lo decide la zona del servidor (`body_zone` / zona de cada síntoma);
 * esta tabla solo ordena. Los indicadores sin dato no se muestran.
 */
export const BODY_SYSTEMS: Record<BodySystemId, { indicators: IndicatorId[] }> = {
  cardiovascular: { indicators: ['heartRate', 'bloodPressure', 'symptoms'] },
  respiratory: { indicators: ['spo2', 'respRate', 'symptoms'] },
  brain: { indicators: ['sleepHours', 'reactionTime', 'symptoms'] },
  eyes: { indicators: ['visionCheck', 'eyePressure', 'symptoms'] },
  skeletal: { indicators: ['exerciseMin', 'urinaryCalcium', 'symptoms'] },
  muscular: { indicators: ['bodyMass', 'gripStrength', 'symptoms'] },
  immune: { indicators: ['bodyTemperature', 'radDoseDaily', 'radDoseCum', 'symptoms'] },
  metabolism: { indicators: ['glucose', 'symptoms'] },
};

export const BODY_SYSTEM_IDS = Object.keys(BODY_SYSTEMS) as BodySystemId[];

/** Gravedad para ordenar/agregar: no evaluado < normal < precaución < crítico. */
export const STATUS_SEVERITY: Record<HealthStatus, number> = { unevaluated: 0, normal: 1, caution: 2, critical: 3 };

/** Estado de un sistema = el peor de sus indicadores (regla del Figma y del servidor). */
export function worstStatus(statuses: HealthStatus[]): HealthStatus {
  return statuses.reduce<HealthStatus>((worst, s) => (STATUS_SEVERITY[s] > STATUS_SEVERITY[worst] ? s : worst), 'unevaluated');
}

export interface BodySystemSummary {
  id: BodySystemId;
  status: HealthStatus;
  indicators: HealthIndicator[];
}
