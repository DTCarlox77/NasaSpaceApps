import type { CrewRole, MissionCrewRole } from './Session';

export type Sex = 'female' | 'male';
export type BloodType = 'O+' | 'O-' | 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-';

/** Tripulante. En la demo son datos sintéticos de relleno (sin backend). */
export interface CrewMember {
  id: string; // NR-A-0000
  fullName: string;
  /** Nombre corto para saludos y listas. */
  displayName: string;
  sex: Sex;
  age: number;
  heightM: number;
  weightKg: number;
  bloodType: BloodType;
  role: CrewRole;
  /** Clave i18n de la especialidad a bordo. */
  specialty: 'commander' | 'flightEngineer' | 'medicalOfficer' | 'missionSpecialist' | 'payloadSpecialist';
  /** Módulo de la estación donde suele estar (para la simulación de proximidad). */
  module: string;
  synthetic: boolean;
}

/** Tripulante real de la misión (GET /missions/{id}/crew). Sin datos de salud. */
export interface RosterMember {
  astronautId: string;
  userId?: string;
  callSign: string;
  fullName: string;
  crewRole: MissionCrewRole;
}

export interface RosterMission {
  id: string;
  code: string;
  name: string;
  startsAt?: string | null;
  endsAt?: string | null;
  environmentName?: string;
  environmentType?: string;
  gravityG?: number;
  commDelaySeconds?: number;
  link?: 'up' | 'down';
}

export type ServerLevel = 'normal' | 'caution' | 'critical' | 'unrated';

/**
 * Estado de la tripulación (GET /api/v1/crew/status). Todos ven emergencia abierta y alertas
 * físicas escaladas a la tripulación (sin valores); solo el oficial médico recibe `physical`.
 * Nunca incluye bienestar.
 */
export interface CrewStatusMember {
  astronautId: string;
  callSign: string;
  displayName: string;
  crewRole: MissionCrewRole;
  emergency: { sessionId: string; status: string } | null;
  crewAlerts: { escalationId: string; indicatorCode: string; indicatorName: string; level: ServerLevel; createdAt: string }[];
  physical: {
    zones: { zone: string; worstLevel: ServerLevel }[];
    indicators: { code: string; level: ServerLevel; lastValue: unknown; measuredAt: string | null }[];
  } | null;
}

export type CrewStatusResult =
  | { status: 'ok'; generatedAt: string; viewerCrewRole: MissionCrewRole | null; crew: CrewStatusMember[] }
  /** El endpoint aún no existe en el servidor (404): "Disponible pronto". */
  | { status: 'unavailable' }
  | { status: 'offline' };

/** Índice de masa corporal (kg/m²). Dato descriptivo, no diagnóstico. */
export const bmi = (m: Pick<CrewMember, 'heightM' | 'weightKg'>) => m.weightKg / (m.heightM * m.heightM);
