import type { BodySystemId, HealthIndicator, HealthStatus, IndicatorId } from './HealthIndicator';

/** Qué indicadores pertenecen a cada sistema (Figma). Los textos (función, recomendaciones) viven en i18n. */
export const BODY_SYSTEMS: Record<BodySystemId, { indicators: IndicatorId[] }> = {
  cardiovascular: { indicators: ['heartRate', 'bloodPressure'] },
  respiratory: { indicators: ['spo2', 'respRate'] },
  brain: { indicators: ['reactionTime'] },
  eyes: { indicators: ['eyePressure'] },
  skeletal: { indicators: ['urinaryCalcium'] },
  muscular: { indicators: ['gripStrength'] },
  immune: { indicators: ['bodyTemperature'] },
};

export const BODY_SYSTEM_IDS = Object.keys(BODY_SYSTEMS) as BodySystemId[];

/** Gravedad para ordenar/agregar: no evaluado < normal < precaución < crítico. */
export const STATUS_SEVERITY: Record<HealthStatus, number> = { unevaluated: 0, normal: 1, caution: 2, critical: 3 };

/** Estado de un sistema = el peor de sus indicadores (regla del Figma). */
export function worstStatus(statuses: HealthStatus[]): HealthStatus {
  return statuses.reduce<HealthStatus>((worst, s) => (STATUS_SEVERITY[s] > STATUS_SEVERITY[worst] ? s : worst), 'unevaluated');
}

export interface BodySystemSummary {
  id: BodySystemId;
  status: HealthStatus;
  indicators: HealthIndicator[];
}
