import type { Hazard } from '@/domain/entities/Hazard';
import type { HazardRepository } from '@/domain/repositories/HazardRepository';
import { hazardsLocalDataSource } from '../datasources/local/hazardsLocalDataSource';

export class HazardRepositoryImpl implements HazardRepository {
  constructor(private readonly local = hazardsLocalDataSource) {}

  getAll(): Promise<Hazard[]> {
    return this.local.getAll();
  }
}
