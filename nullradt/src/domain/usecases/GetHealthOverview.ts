import { BODY_SYSTEM_IDS, BODY_SYSTEMS, STATUS_SEVERITY, worstStatus, type BodySystemSummary } from '../entities/BodySystem';
import type { HealthIndicator, HealthStatus } from '../entities/HealthIndicator';
import type { HealthRepository, HealthSnapshot } from '../repositories/HealthRepository';

export interface HealthOverview {
  snapshot: HealthSnapshot;
  indicators: HealthIndicator[];
  systems: BodySystemSummary[];
  counts: Record<HealthStatus, number>;
  /** Indicadores en precaución o crítico, del más grave al menos grave. */
  needsAttention: HealthIndicator[];
}

/** Agrega los indicadores por sistema del cuerpo y calcula el resumen de salud (función pura). */
export function buildOverview(snapshot: HealthSnapshot): HealthOverview {
  const systems = BODY_SYSTEM_IDS.map((id) => {
    const order = BODY_SYSTEMS[id].indicators;
    const rank = (i: HealthIndicator) => (order.includes(i.id) ? order.indexOf(i.id) : order.length);
    const indicators = snapshot.indicators.filter((i) => i.systemId === id).sort((a, b) => rank(a) - rank(b));
    return { id, indicators, status: worstStatus(indicators.map((i) => i.status)) };
  });

  const counts: Record<HealthStatus, number> = { normal: 0, caution: 0, critical: 0, unevaluated: 0 };
  snapshot.indicators.forEach((i) => counts[i.status]++);

  const needsAttention = snapshot.indicators
    .filter((i) => i.status === 'caution' || i.status === 'critical')
    .sort((a, b) => STATUS_SEVERITY[b.status] - STATUS_SEVERITY[a.status]);

  return { snapshot, indicators: snapshot.indicators, systems, counts, needsAttention };
}

export class GetHealthOverview {
  constructor(private readonly repository: HealthRepository) {}

  async execute(): Promise<HealthOverview> {
    return buildOverview(await this.repository.getSnapshot());
  }
}
