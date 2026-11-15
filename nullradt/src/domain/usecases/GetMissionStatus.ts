import type { Mission, MissionStatus } from '../entities/Mission';
import type { MissionRepository } from '../repositories/MissionRepository';

export class GetMissionStatus {
  constructor(private readonly repository: MissionRepository) {}

  execute(): Promise<MissionStatus> {
    return this.repository.getStatus();
  }
}

export class GetMissions {
  constructor(private readonly repository: MissionRepository) {}

  execute(): Promise<Mission[]> {
    return this.repository.getMissions();
  }
}
