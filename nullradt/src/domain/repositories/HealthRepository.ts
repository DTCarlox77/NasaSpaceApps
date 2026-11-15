import type { HealthIndicator } from '../entities/HealthIndicator';

export interface HealthSnapshot {
  indicators: HealthIndicator[];
  /** De dónde salieron los datos: backend, caché offline o maqueta. */
  origin: 'remote' | 'cache' | 'mock';
  fetchedAt: string;
}

export interface HealthRepository {
  getSnapshot(): Promise<HealthSnapshot>;
}
