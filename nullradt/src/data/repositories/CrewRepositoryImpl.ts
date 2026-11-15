import type { CrewRepository } from '@/domain/repositories/CrewRepository';
import { crewMockDataSource } from '../datasources/mock/crewMockDataSource';

/** Sin backend: tripulación sintética de relleno. Con backend: GET /api/v1/crew (pendiente). */
export class CrewRepositoryImpl implements CrewRepository {
  constructor(private readonly mock = crewMockDataSource) {}

  list() {
    return this.mock.list();
  }
}
