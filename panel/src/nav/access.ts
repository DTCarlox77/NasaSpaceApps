/**
 * Matriz rol → secciones del panel: ÚNICA fuente de permisos de navegación en el panel.
 *
 * `contractRoles` copia el `x-roles` de docs/openapi.yaml (v1.7) de los endpoints que usará
 * cada sección; `roles` son los que ven la sección en el panel, siempre un subconjunto de los
 * del contrato, con estas reglas fijas además del contrato:
 * - Salud conductual: SOLO behavioral_health (admin y flight_surgeon nunca ven nada conductual).
 * - Cumplimiento y Demo: SOLO admin.
 * El backend vuelve a comprobar el rol en cada petición (403 si no corresponde): esto solo
 * decide qué se muestra.
 */
import type { GroundRole, Role } from '../api/types.ts';

export type SectionId = 'crew' | 'alerts' | 'emergencies' | 'behavioral' | 'compliance' | 'demo';

export interface Section {
  id: SectionId;
  title: string;
  path: string;
  /** Endpoints del contrato que usará la sección. */
  endpoints: string[];
  /** x-roles del contrato (de esos endpoints). */
  contractRoles: GroundRole[];
  /** Roles que ven la sección en el panel. */
  roles: GroundRole[];
  /** Fase del plan en que se implementa (en P1 es un placeholder). */
  phase: 'P2' | 'P3' | 'P4';
  summary: string;
}

export const SECTIONS: readonly Section[] = [
  {
    id: 'crew',
    title: 'Dashboard de tripulación',
    path: '/tripulacion',
    endpoints: ['GET /admin/dashboard/crew'],
    contractRoles: ['flight_surgeon', 'admin'],
    roles: ['flight_surgeon', 'admin'],
    phase: 'P2',
    summary: 'Semáforo físico de cada tripulante, tendencias y aptitud (fit / not_confirmed).',
  },
  {
    id: 'alerts',
    title: 'Alertas',
    path: '/alertas',
    endpoints: [
      'GET /admin/inbox',
      'POST /admin/escalations/{id}/ack',
      'POST /admin/escalations/{id}/messages',
    ],
    contractRoles: ['flight_surgeon', 'admin'],
    roles: ['flight_surgeon', 'admin'],
    phase: 'P2',
    summary: 'Bandeja de escalamientos que ya llegaron a Tierra, acuse y respuesta con retraso.',
  },
  {
    id: 'emergencies',
    title: 'Emergencias',
    path: '/emergencias',
    endpoints: ['GET /admin/emergencies', 'GET /admin/emergencies/{id}'],
    contractRoles: ['flight_surgeon', 'admin'],
    roles: ['flight_surgeon', 'admin'],
    phase: 'P3',
    summary: 'Sesiones de triaje, línea de tiempo y reporte (admin: solo estado operativo).',
  },
  {
    id: 'behavioral',
    title: 'Salud conductual',
    path: '/salud-conductual',
    endpoints: [
      'GET /admin/behavioral/inbox',
      'GET /admin/behavioral/astronauts/{id}',
      'POST /admin/behavioral/support-requests/{id}/messages',
      'POST /admin/behavioral/support-requests/{id}/ack',
      'POST /admin/behavioral/support-requests/{id}/close',
      'POST /admin/behavioral/escalations/{id}/ack',
      'POST /admin/behavioral/escalations/{id}/close',
      'GET /admin/audit/confidential-access',
    ],
    contractRoles: ['behavioral_health'],
    roles: ['behavioral_health'],
    phase: 'P4',
    summary: 'Bandeja confidencial de bienestar, detalle por astronauta y auditoría de accesos.',
  },
  {
    id: 'compliance',
    title: 'Cumplimiento',
    path: '/cumplimiento',
    endpoints: ['GET /admin/compliance'],
    contractRoles: ['admin'],
    roles: ['admin'],
    phase: 'P3',
    summary: 'Check-ins completados y aptitud por tripulante (sin valores de bienestar).',
  },
  {
    id: 'demo',
    title: 'Demo',
    path: '/demo',
    endpoints: ['POST /admin/demo/reset'],
    contractRoles: ['admin'],
    roles: ['admin'],
    phase: 'P3',
    summary: 'Reinicio de la demo de ARES-1 (solo demo; pide confirmación).',
  },
];

export const ROLE_LABELS: Record<GroundRole, string> = {
  admin: 'Control de misión',
  flight_surgeon: 'Flight surgeon',
  behavioral_health: 'Salud conductual',
};

const isGround = (role: Role | null | undefined): role is GroundRole =>
  role === 'admin' || role === 'flight_surgeon' || role === 'behavioral_health';

/** Secciones visibles para un rol (ninguna si no es del equipo en Tierra). */
export function sectionsFor(role: Role | null | undefined): Section[] {
  if (!isGround(role)) return [];
  return SECTIONS.filter((s) => s.roles.includes(role));
}

export function canSee(role: Role | null | undefined, id: SectionId): boolean {
  return sectionsFor(role).some((s) => s.id === id);
}

export function sectionById(id: SectionId): Section {
  const section = SECTIONS.find((s) => s.id === id);
  if (!section) throw new Error(`Sección desconocida: ${id}`);
  return section;
}

/** ¿El rol puede abrir esta ruta del panel? (p. ej. para volver a donde estaba tras el login). */
export function canOpenPath(role: Role | null | undefined, path: string): boolean {
  return sectionsFor(role).some((s) => path === s.path || path.startsWith(`${s.path}/`));
}

/** Ruta inicial: admin y flight_surgeon → Dashboard; behavioral_health → Salud conductual. */
export function homePathFor(role: Role | null | undefined): string {
  return sectionsFor(role)[0]?.path ?? '/login';
}
