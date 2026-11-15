/**
 * Roles como etiquetas: texto, tono de color y una línea de "qué ve en el sistema".
 * - Rol global (cuenta, `Role` del contrato) y rol en la misión (`CrewRole`, solo astronautas),
 *   con los valores exactos del contrato.
 * - Las descripciones resumen la tabla "Quién ve qué" del contrato (v1.8) y GET /crew/status.
 * El color siempre acompaña al texto (nunca lo reemplaza).
 */
import type { CrewRole, Role } from '../api/types.ts';

export interface RoleInfo {
  label: string;
  /** Una línea: lo que ese rol ve en el sistema. */
  hint: string;
  /** Tono de la etiqueta (clase CSS role-<tone>). */
  tone: string;
}

export const GLOBAL_ROLE_INFO: Record<Role, RoleInfo> = {
  admin: {
    label: 'Control de misión',
    hint: 'Cuentas, cumplimiento y estado operativo; nunca datos clínicos ni de bienestar.',
    tone: 'admin',
  },
  flight_surgeon: {
    label: 'Cirujano de vuelo',
    hint: 'Semáforo físico, alertas, emergencias y aptitud; sin respuestas individuales de bienestar.',
    tone: 'surgeon',
  },
  behavioral_health: {
    label: 'Salud conductual',
    hint: 'Detalle confidencial de bienestar; cada consulta se registra.',
    tone: 'behavioral',
  },
  astronaut: {
    label: 'Astronauta',
    hint: 'Solo sus propios datos, en la app móvil; no entra al panel.',
    tone: 'astronaut',
  },
  service: {
    label: 'Sensores del hábitat',
    hint: 'Cuenta de servicio: solo envía lecturas del módulo.',
    tone: 'service',
  },
};

export const CREW_ROLE_INFO: Record<CrewRole, RoleInfo> = {
  commander: {
    label: 'Comandante',
    hint: 'Permisos de acceso delegados; nunca datos médicos.',
    tone: 'commander',
  },
  crew_medical_officer: {
    label: 'Oficial médico',
    hint: 'Estado físico de la tripulación a bordo; nunca bienestar.',
    tone: 'cmo',
  },
  pilot: {
    label: 'Piloto',
    hint: 'Sus propios datos y las alertas físicas de la tripulación, sin valores.',
    tone: 'crew',
  },
  flight_engineer: {
    label: 'Ingeniería de vuelo',
    hint: 'Sus propios datos y las alertas físicas de la tripulación, sin valores.',
    tone: 'crew',
  },
  mission_specialist: {
    label: 'Especialista',
    hint: 'Sus propios datos y las alertas físicas de la tripulación, sin valores.',
    tone: 'crew',
  },
};

/** Roles de tripulación en el orden de las opciones (los del contrato). */
export const CREW_ROLES: readonly CrewRole[] = [
  'commander',
  'crew_medical_officer',
  'pilot',
  'flight_engineer',
  'mission_specialist',
];

/** Roles de Tierra que puede crear control de misión. */
export const GROUND_ACCOUNT_ROLES = ['admin', 'flight_surgeon', 'behavioral_health'] as const;

/** Como máximo uno por misión (contrato: CREW_ROLE_TAKEN). */
export const UNIQUE_CREW_ROLES: readonly CrewRole[] = ['commander', 'crew_medical_officer'];

export const globalRoleInfo = (role: string): RoleInfo =>
  GLOBAL_ROLE_INFO[role as Role] ?? { label: role, hint: '', tone: 'unknown' };

export const crewRoleInfo = (role: string): RoleInfo =>
  CREW_ROLE_INFO[role as CrewRole] ?? { label: role, hint: '', tone: 'unknown' };
