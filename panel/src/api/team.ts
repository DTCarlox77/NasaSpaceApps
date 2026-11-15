/**
 * Equipo de la misión (solo admin = control de misión).
 * Contrato v1.8:
 * - GET  /missions/{id}/crew                     x-roles: astronaut, flight_surgeon, behavioral_health, admin
 * - GET  /admin/assignments?mission_id=&active=  x-roles: admin
 * - POST /admin/users                            x-roles: admin (contraseña temporal mostrada una vez)
 * - POST /admin/users/{id}/reset-password        x-roles: admin
 * - POST /admin/users/{id}/unlock                x-roles: admin
 * - PATCH /admin/assignments/{id} { crew_role }  x-roles: admin (cambiar rol en la misión)
 * SOLO modo demo (no existe en el contrato; en modo api NO se llama):
 * - GET  /admin/users?kind=crew|ground           lista de cuentas con su estado
 */
import { isMockMode } from '../config/env.ts';
import { HttpError, request } from './http.ts';
import { withQuery } from './params.ts';
import type {
  Assignment,
  AssignmentPage,
  CreatedUser,
  CreateUserRequest,
  CrewPage,
  CrewRole,
  TeamAccountPage,
  TemporaryPasswordResponse,
  UserAdmin,
} from './types.ts';

const id = (value: string) => encodeURIComponent(value);

export function getMissionCrew(missionId: string, signal?: AbortSignal): Promise<CrewPage> {
  return request<CrewPage>(withQuery(`/missions/${id(missionId)}/crew`, { limit: 200 }), { signal });
}

export function getAssignments(missionId: string, signal?: AbortSignal): Promise<AssignmentPage> {
  return request<AssignmentPage>(
    withQuery('/admin/assignments', { mission_id: missionId, active: 'true', limit: 200 }),
    { signal },
  );
}

/**
 * Cuentas con su estado (usuario, bloqueo, cambio pendiente, último acceso). El contrato v1.8 no
 * tiene esta lista: solo existe en el modo demo; en modo api devuelve null sin llamar a la red.
 */
export async function getTeamAccounts(kind: 'crew' | 'ground', signal?: AbortSignal): Promise<TeamAccountPage | null> {
  if (!isMockMode()) return null;
  return request<TeamAccountPage>(withQuery('/admin/users', { kind, limit: 200 }), { signal });
}

export function createUser(body: CreateUserRequest): Promise<CreatedUser> {
  return request<CreatedUser>('/admin/users', { method: 'POST', body });
}

export function resetPassword(userId: string): Promise<TemporaryPasswordResponse> {
  return request<TemporaryPasswordResponse>(`/admin/users/${id(userId)}/reset-password`, { method: 'POST' });
}

export function unlockUser(userId: string): Promise<UserAdmin> {
  return request<UserAdmin>(`/admin/users/${id(userId)}/unlock`, { method: 'POST' });
}

export function changeCrewRole(assignmentId: string, crewRole: CrewRole): Promise<Assignment> {
  return request<Assignment>(`/admin/assignments/${id(assignmentId)}`, {
    method: 'PATCH',
    body: { crew_role: crewRole },
  });
}

/** Campo del formulario al que apunta un 409/400 del alta (contrato: error.details.field). */
export function errorField(err: unknown): 'username' | 'call_sign' | 'crew_role' | 'email' | null {
  if (!(err instanceof HttpError)) return null;
  if (err.code === 'USERNAME_TAKEN') return 'username';
  if (err.code === 'CALL_SIGN_TAKEN') return 'call_sign';
  if (err.code === 'CREW_ROLE_TAKEN') return 'crew_role';
  if (err.code === 'EMAIL_TAKEN') return 'email';
  const field = (err.details as { field?: string } | null)?.field;
  if (field === 'username') return 'username';
  if (field === 'astronaut.call_sign') return 'call_sign';
  if (field === 'astronaut.crew_role') return 'crew_role';
  return null;
}
