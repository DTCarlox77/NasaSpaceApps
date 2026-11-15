import type { CrewMember, CrewStatusResult, RosterMember, RosterMission } from '../entities/Crew';

export interface CrewRepository {
  /** Tripulación sintética de la maqueta (solo modo demo sin servidor; con API devuelve []). */
  list(): Promise<CrewMember[]>;
  /** Roster real: GET /missions/current + GET /missions/{id}/crew. null sin API o sin conexión. */
  getRoster(): Promise<{ mission: RosterMission; members: RosterMember[] } | null>;
  /** Salud de compañeros: solo GET /api/v1/crew/status (404 → 'unavailable'). */
  getStatus(): Promise<CrewStatusResult>;
}
