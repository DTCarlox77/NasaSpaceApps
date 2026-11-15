import type { EscalationLevel, HealthStatus, ReferenceRange } from '../entities/HealthIndicator';

export interface Evaluation {
  status: HealthStatus;
  escalation: EscalationLevel;
}

const inRange = (value: number, r: { min?: number; max?: number }) =>
  (r.min === undefined || value >= r.min) && (r.max === undefined || value <= r.max);

/**
 * Motor de reglas (base). Función pura: fácil de probar y de reutilizar en backend.
 * normal -> autocuidado, precaución -> tripulación, crítico -> flight surgeon.
 */
export function evaluateMeasurement(value: number, range: ReferenceRange): Evaluation {
  if (inRange(value, range.normal)) return { status: 'normal', escalation: 'self' };
  if (inRange(value, range.caution)) return { status: 'caution', escalation: 'crew' };
  return { status: 'critical', escalation: 'flightSurgeon' };
}
