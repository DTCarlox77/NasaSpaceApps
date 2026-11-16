import type { Mission, MissionStatus } from '../entities/Mission';

export interface MissionRepository {
  getStatus(): Promise<MissionStatus>;
  getMissions(): Promise<Mission[]>;
}
