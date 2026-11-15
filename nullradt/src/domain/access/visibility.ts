import type { GlobalRole, MissionCrewRole } from '../entities/Session';

/**
 * FILTRO DE CONFIDENCIALIDAD — "quién ve qué" (función pura; la misma regla en el dispositivo y en el servidor).
 *
 * Clases de datos:
 *  - wellbeingDetail: check-ins, puntuaciones, detalle de la prueba de reacción, cuestionarios, mensajes con salud conductual
 *  - wellbeingStatus: estado resumido y alertas escaladas
 *  - fitness:         aptitud para tarea crítica (solo "apto: sí / no confirmado")
 *  - compliance:      cumplimiento (hizo o no el check-in / la prueba), nunca el contenido
 *  - medical:         signos vitales e indicadores físicos
 */
export type DataClass = 'wellbeingDetail' | 'wellbeingStatus' | 'fitness' | 'compliance' | 'medical';
export const DATA_CLASSES: DataClass[] = ['wellbeingDetail', 'wellbeingStatus', 'fitness', 'compliance', 'medical'];

export interface Viewer {
  userId: string;
  role: GlobalRole;
  crewRole?: MissionCrewRole;
}

export interface VisibilityContext {
  /** El astronauta decidió compartir su bienestar con comandante / oficial médico (desactivado por defecto). */
  sharedWithCrew: boolean;
  /** Hay un triaje de emergencia activo. */
  emergency: boolean;
}

const BY_ROLE: Record<GlobalRole, DataClass[]> = {
  behavioral_health: ['wellbeingDetail', 'wellbeingStatus', 'fitness', 'compliance'],
  flight_surgeon: ['wellbeingStatus', 'fitness', 'compliance', 'medical'],
  admin: ['compliance', 'fitness'],
  astronaut: [],
};

export type VisibilityReason = 'self' | 'role' | 'shared' | 'emergency' | 'onboardCare' | 'denied';

export function canView(viewer: Viewer, subjectId: string, data: DataClass, ctx: VisibilityContext): { allowed: boolean; reason: VisibilityReason } {
  if (viewer.userId === subjectId) return { allowed: true, reason: 'self' };
  if (BY_ROLE[viewer.role].includes(data)) return { allowed: true, reason: 'role' };
  if (viewer.role === 'astronaut') {
    const leader = viewer.crewRole === 'commander' || viewer.crewRole === 'crew_medical_officer';
    // El oficial médico a bordo atiende signos vitales (no bienestar).
    if (viewer.crewRole === 'crew_medical_officer' && data === 'medical') return { allowed: true, reason: 'onboardCare' };
    if (leader && ctx.emergency && (data === 'wellbeingStatus' || data === 'medical' || data === 'fitness')) return { allowed: true, reason: 'emergency' };
    if (leader && ctx.sharedWithCrew && (data === 'wellbeingStatus' || data === 'fitness')) return { allowed: true, reason: 'shared' };
  }
  return { allowed: false, reason: 'denied' };
}

/** Perfiles para la tabla "quién ve qué" en la UI. */
export const VIEWER_PROFILES: { key: string; viewer: Omit<Viewer, 'userId'> }[] = [
  { key: 'behavioral_health', viewer: { role: 'behavioral_health' } },
  { key: 'flight_surgeon', viewer: { role: 'flight_surgeon' } },
  { key: 'admin', viewer: { role: 'admin' } },
  { key: 'commander', viewer: { role: 'astronaut', crewRole: 'commander' } },
  { key: 'medical_officer', viewer: { role: 'astronaut', crewRole: 'crew_medical_officer' } },
  { key: 'crew', viewer: { role: 'astronaut', crewRole: 'mission_specialist' } },
];
