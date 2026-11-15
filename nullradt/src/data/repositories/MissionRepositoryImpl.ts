import type { Mission, MissionStatus } from '@/domain/entities/Mission';
import type { MissionRepository } from '@/domain/repositories/MissionRepository';
import { syntheticMissionDataSource } from '../datasources/local/syntheticMissionDataSource';

export class MissionRepositoryImpl implements MissionRepository {
  constructor(private readonly local = syntheticMissionDataSource) {}

  getStatus(): Promise<MissionStatus> {
    return this.local.getStatus();
  }

  getMissions(): Promise<Mission[]> {
    return this.local.getMissions();
  }
}
