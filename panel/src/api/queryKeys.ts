/**
 * Claves de React Query.
 * - Toda consulta de datos de una misión empieza por ['mission', mission_id, …] y manda el mismo
 *   mission_id en la URL: al cambiar de misión, el AuthProvider borra todas las que empiezan
 *   por 'mission' (no se mezclan datos de dos misiones).
 * - El catálogo de indicadores no depende de la misión: va aparte.
 */
export const MISSION_DATA = 'mission' as const;

export interface InboxFilters {
  category?: 'reading' | 'emergency' | 'wellbeing' | 'manual';
  status?: 'delivered' | 'acknowledged' | 'responded';
}

export const queryKeys = {
  currentMission: (missionId: string) => [MISSION_DATA, missionId, 'current'] as const,
  crewDashboard: (missionId: string) => [MISSION_DATA, missionId, 'dashboard'] as const,
  inbox: (missionId: string, filters: InboxFilters) =>
    [MISSION_DATA, missionId, 'inbox', filters] as const,
  inboxUnacknowledged: (missionId: string) => [MISSION_DATA, missionId, 'inbox-unacknowledged'] as const,
  sentMessages: (missionId: string, escalationId: string) =>
    [MISSION_DATA, missionId, 'sent-messages', escalationId] as const,
  indicatorCatalog: () => ['catalog', 'indicators'] as const,
  emergencies: (missionId: string, status: string) =>
    [MISSION_DATA, missionId, 'emergencies', status] as const,
  /** Aviso global de la cabecera (primera página sin filtro). */
  emergenciesOpen: (missionId: string) => [MISSION_DATA, missionId, 'emergencies-open'] as const,
  emergency: (missionId: string, id: string) => [MISSION_DATA, missionId, 'emergency', id] as const,
};
