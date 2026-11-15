import type { Hazard } from '../entities/Hazard';

/** Contrato del dominio. La capa de datos decide de dónde salen (local, API, SQLite). */
export interface HazardRepository {
  getAll(): Promise<Hazard[]>;
}
