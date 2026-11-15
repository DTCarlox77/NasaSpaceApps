/**
 * Lógica de Equipo (sin React, para probarla sola): usuario sugerido, validaciones del alta,
 * estado de cada cuenta y la tripulación armada con lo que da el contrato.
 * Manda el backend: estas validaciones solo adelantan sus 409 (USERNAME_TAKEN, CALL_SIGN_TAKEN,
 * CREW_ROLE_TAKEN); si el backend responde otra cosa, se muestra eso.
 */
import type { Assignment, CrewMember, CrewRole, TeamAccount, UserAdmin } from '../../api/types.ts';
import { UNIQUE_CREW_ROLES } from '../../nav/roles.ts';

/** Contrato: CreateUserRequest.username. */
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,40}$/;
export const CALL_SIGN_MIN = 2;
export const CALL_SIGN_MAX = 20;

const words = (fullName: string): string[] =>
  fullName
    .replace(/\([^)]*\)/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Usuario sugerido: inicial del nombre + "." + primer apellido, en minúsculas y sin acentos
 * ("Juan Pérez" → j.perez; "Ana María López García" → a.lopez). Editable.
 */
export function suggestUsername(fullName: string): string {
  const parts = words(fullName);
  if (parts.length === 0) return '';
  const first = parts[0] as string;
  if (parts.length === 1) return first.slice(0, 40);
  const surname = (parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1]) as string;
  return `${first[0]}.${surname}`.slice(0, 40);
}

/** Indicativo: mayúsculas, sin espacios (letras, números y guion). */
export const normalizeCallSign = (value: string): string =>
  value
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, CALL_SIGN_MAX);

export type TeamKind = 'crew' | 'ground';

export interface AccountDraft {
  kind: TeamKind;
  full_name: string;
  username: string;
  call_sign: string;
  crew_role: CrewRole | '';
  role: 'admin' | 'flight_surgeon' | 'behavioral_health' | '';
}

export type DraftErrors = Partial<Record<'full_name' | 'username' | 'call_sign' | 'crew_role' | 'role', string>>;

/**
 * Paso 1 (datos). `usernames` = usuarios conocidos (null si no hay lista: modo api; entonces
 * lo dice el backend con 409). `callSigns` = indicativos de la misión.
 */
export function validateDetails(
  draft: AccountDraft,
  usernames: ReadonlySet<string> | null,
  callSigns: ReadonlySet<string>,
): DraftErrors {
  const errors: DraftErrors = {};
  const name = draft.full_name.trim();
  if (!name) errors.full_name = 'Escribe el nombre completo.';
  else if (name.length > 120) errors.full_name = 'Como máximo 120 caracteres.';
  if (!USERNAME_PATTERN.test(draft.username)) {
    errors.username = 'De 3 a 40 caracteres: minúsculas, números, punto, guion o guion bajo.';
  } else if (usernames?.has(draft.username.toLowerCase())) {
    errors.username = `El usuario ${draft.username} ya existe.`;
  }
  if (draft.kind === 'crew') {
    const cs = draft.call_sign;
    if (cs.length < CALL_SIGN_MIN || cs.length > CALL_SIGN_MAX) {
      errors.call_sign = `De ${CALL_SIGN_MIN} a ${CALL_SIGN_MAX} caracteres, en mayúsculas.`;
    } else if (callSigns.has(cs.toUpperCase())) {
      errors.call_sign = `El indicativo ${cs} ya está en la misión.`;
    }
  }
  return errors;
}

/** Paso 2 (rol). `taken` = rol único de la misión → indicativo de quien lo tiene. */
export function validateRole(draft: AccountDraft, taken: ReadonlyMap<CrewRole, string>): DraftErrors {
  if (draft.kind === 'crew') {
    if (!draft.crew_role) return { crew_role: 'Elige el rol en la misión.' };
    const holder = taken.get(draft.crew_role);
    if (holder) return { crew_role: `La misión ya tiene ese rol (${holder}): como máximo uno por misión.` };
    return {};
  }
  return draft.role ? {} : { role: 'Elige el rol de la cuenta.' };
}

// ---------------------------------------------------------------- estado de la cuenta

export type AccountStatus = 'active' | 'locked' | 'must_change' | 'inactive';

export const ACCOUNT_STATUS_META: Record<AccountStatus, { icon: string; text: string }> = {
  active: { icon: '●', text: 'Activa' },
  locked: { icon: '■', text: 'Bloqueada' },
  must_change: { icon: '▲', text: 'Cambio de contraseña pendiente' },
  inactive: { icon: '○', text: 'Inactiva' },
};

export function accountStatus(account: Pick<UserAdmin, 'is_active' | 'locked_until' | 'must_change_password'>, now: number): AccountStatus {
  if (!account.is_active) return 'inactive';
  if (account.locked_until && new Date(account.locked_until).getTime() > now) return 'locked';
  if (account.must_change_password) return 'must_change';
  return 'active';
}

// ---------------------------------------------------------------- tripulación

export interface CrewRow {
  astronaut_id: string;
  user_id: string | null;
  call_sign: string;
  full_name: string;
  crew_role: CrewRole;
  assigned_from: string;
  /** Para cambiar el rol (PATCH /admin/assignments/{id}). */
  assignment_id: string | null;
  /** Solo en el modo demo (GET /admin/users): usuario, estado y último acceso. */
  account: TeamAccount | null;
}

/** Tripulación del contrato (GET /missions/{id}/crew) + asignaciones + cuentas (solo demo). */
export function buildCrewRows(
  crew: CrewMember[],
  assignments: Assignment[] | null,
  accounts: TeamAccount[] | null,
): CrewRow[] {
  const assignmentByAstronaut = new Map((assignments ?? []).map((a) => [a.astronaut_id, a]));
  const accountByUser = new Map((accounts ?? []).map((a) => [a.id, a]));
  return crew
    .map((member) => ({
      astronaut_id: member.astronaut_id,
      user_id: member.user_id ?? null,
      call_sign: member.call_sign,
      full_name: member.full_name,
      crew_role: assignmentByAstronaut.get(member.astronaut_id)?.crew_role ?? member.crew_role,
      assigned_from: member.assigned_from,
      assignment_id: assignmentByAstronaut.get(member.astronaut_id)?.id ?? null,
      account: (member.user_id ? accountByUser.get(member.user_id) : undefined) ?? null,
    }))
    .sort((a, b) => a.call_sign.localeCompare(b.call_sign));
}

/** Roles únicos ocupados (Comandante, Oficial médico) → indicativo de quien lo tiene. */
export function takenCrewRoles(rows: Pick<CrewRow, 'crew_role' | 'call_sign'>[], exceptCallSign?: string): Map<CrewRole, string> {
  const taken = new Map<CrewRole, string>();
  for (const row of rows) {
    if (row.call_sign === exceptCallSign) continue;
    if (UNIQUE_CREW_ROLES.includes(row.crew_role)) taken.set(row.crew_role, row.call_sign);
  }
  return taken;
}

/** Búsqueda sin distinguir mayúsculas ni acentos. */
export function matchesSearch(query: string, fields: (string | null | undefined)[]): boolean {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = norm(query.trim());
  if (!q) return true;
  return fields.some((f) => !!f && norm(f).includes(q));
}
