import type { Hazard } from '../entities/Hazard';
import type { HazardRepository } from '../repositories/HazardRepository';

export class GetHazards {
  constructor(private readonly repository: HazardRepository) {}

  execute(): Promise<Hazard[]> {
    return this.repository.getAll();
  }
}
