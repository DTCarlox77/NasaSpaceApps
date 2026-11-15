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
  /** Respuestas enviadas desde esta sesión (se muestran aunque el hilo aún no las traiga). */
  sentMessages: (missionId: string, escalationId: string) =>
    [MISSION_DATA, missionId, 'sent-messages', escalationId] as const,
  /** GET /admin/escalations/{id}/messages (hilo desde Tierra, v1.8). */
  thread: (missionId: string, escalationId: string) =>
    [MISSION_DATA, missionId, 'thread', escalationId] as const,
  indicatorCatalog: () => ['catalog', 'indicators'] as const,
  emergencies: (missionId: string, status: string) =>
    [MISSION_DATA, missionId, 'emergencies', status] as const,
  /** Aviso global de la cabecera (primera página sin filtro). */
  emergenciesOpen: (missionId: string) => [MISSION_DATA, missionId, 'emergencies-open'] as const,
  emergency: (missionId: string, id: string) => [MISSION_DATA, missionId, 'emergency', id] as const,
  // Salud conductual (confidencial: solo behavioral_health).
  behavioralInbox: (missionId: string, includeClosed: boolean) =>
    [MISSION_DATA, missionId, 'behavioral-inbox', includeClosed] as const,
  behavioralAstronaut: (missionId: string, astronautId: string) =>
    [MISSION_DATA, missionId, 'behavioral-astronaut', astronautId] as const,
  confidentialAccess: (missionId: string) => [MISSION_DATA, missionId, 'confidential-access'] as const,
  // Equipo (solo admin).
  missionCrew: (missionId: string) => [MISSION_DATA, missionId, 'team', 'crew'] as const,
  assignments: (missionId: string) => [MISSION_DATA, missionId, 'team', 'assignments'] as const,
  /** SOLO modo demo: GET /admin/users. */
  teamAccounts: (missionId: string, kind: 'crew' | 'ground') => [MISSION_DATA, missionId, 'team', 'accounts', kind] as const,
  /** Respuestas a una solicitud de apoyo enviadas en esta sesión (el contrato no da el hilo a Tierra). */
  supportReplies: (missionId: string, requestId: string) =>
    [MISSION_DATA, missionId, 'support-replies', requestId] as const,
};
