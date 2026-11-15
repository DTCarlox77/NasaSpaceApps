import type { CrewRole } from './Session';

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

/** Índice de masa corporal (kg/m²). Dato descriptivo, no diagnóstico. */
export const bmi = (m: Pick<CrewMember, 'heightM' | 'weightKg'>) => m.weightKg / (m.heightM * m.heightM);
