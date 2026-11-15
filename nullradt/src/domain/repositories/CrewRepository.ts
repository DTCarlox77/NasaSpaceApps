import type { CrewMember } from '../entities/Crew';

export interface CrewRepository {
  list(): Promise<CrewMember[]>;
}
