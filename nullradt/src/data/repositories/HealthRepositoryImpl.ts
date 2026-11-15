import { env } from '@/core/config/env';
import type { HealthRepository, HealthSnapshot } from '@/domain/repositories/HealthRepository';
import { healthCacheDataSource } from '../datasources/local/healthCacheDataSource';
import { healthMockDataSource } from '../datasources/mock/healthMockDataSource';
import { healthRemoteDataSource } from '../datasources/remote/healthRemoteDataSource';

/**
 * Offline-first:
 * - Con API configurada: backend → (guarda caché) ; si falla, última caché.
 * - Sin API (demo): maqueta del Figma, marcada como sintética.
 */
export class HealthRepositoryImpl implements HealthRepository {
  constructor(
    private readonly remote = healthRemoteDataSource,
    private readonly cache = healthCacheDataSource,
    private readonly mock = healthMockDataSource,
  ) {}

  async getSnapshot(): Promise<HealthSnapshot> {
    if (!env.apiUrl) {
      return { indicators: await this.mock.getIndicators(), origin: 'mock', fetchedAt: new Date().toISOString() };
    }
    try {
      const indicators = await this.remote.getIndicators();
      const fetchedAt = new Date().toISOString();
      await this.cache.set(indicators, fetchedAt).catch(() => {});
      return { indicators, origin: 'remote', fetchedAt };
    } catch (e) {
      const cached = await this.cache.get();
      if (cached) return { ...cached, origin: 'cache' };
      throw e;
    }
  }
}
