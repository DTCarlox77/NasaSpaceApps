import type { CrewMember } from '../entities/Crew';
import type { CrewRepository } from '../repositories/CrewRepository';

export class GetCrew {
  constructor(private readonly repository: CrewRepository) {}

  execute(): Promise<CrewMember[]> {
    return this.repository.list();
  }
}

export class GetCrewRoster {
  constructor(private readonly repository: CrewRepository) {}

  execute() {
    return this.repository.getRoster();
  }
}

export class GetCrewStatus {
  constructor(private readonly repository: CrewRepository) {}

  execute() {
    return this.repository.getStatus();
  }
}
