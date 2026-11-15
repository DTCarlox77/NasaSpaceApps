/**
 * Cuentas del modo demo (SINTÉTICAS): las del seed del backend con su estado de cuenta, más las
 * que crea control de misión en el demo (se guardan en localStorage, contraseñas solo como hash).
 * - k.mensah (VEGA) está bloqueado por intentos fallidos: sirve para mostrar "Desbloquear".
 * - m.silva (ATLAS) tiene el cambio de contraseña pendiente, como en el seed.
 * - `password_hash: null` = cuenta del seed sin contraseña fija: en el demo entra con cualquiera.
 */
import type { CrewRole, Role } from '../../types.ts';
import { MISSION_ID } from './mission.ts';
import { CREW, GROUND_USERS } from './people.ts';

export interface MockAstronautProfile {
  id: string;
  call_sign: string;
  agency: string | null;
  mission_id: string;
  crew_role: CrewRole;
  assignment_id: string;
  assigned_from: string;
}

export interface MockAccount {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  role: Role;
  must_change_password: boolean;
  is_active: boolean;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  /** SHA-256 de `${id}:${contraseña}`; null = cuenta del seed que acepta cualquier contraseña. */
  password_hash: string | null;
  /** true si control de misión la creó en el demo (se guarda completa). */
  created_in_demo?: boolean;
  /** Los refresh tokens emitidos antes de este instante (ms) ya no sirven (reset, cambio). */
  tokens_valid_after?: number;
  astronaut?: MockAstronautProfile;
  ground_mission_ids?: string[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

export function buildAccounts(t0: number): MockAccount[] {
  const created = iso(t0 - 45 * DAY);
  const base = {
    email: null,
    must_change_password: false,
    is_active: true,
    failed_login_attempts: 0,
    locked_until: null,
    created_at: created,
    password_hash: null,
  };
  const ground: MockAccount[] = GROUND_USERS.map((user, i) => ({
    ...base,
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    email: `${user.username.split('.')[0]}@demo.local`,
    last_login_at: iso(t0 - (i + 1) * 5 * HOUR),
    ground_mission_ids: [MISSION_ID],
  }));
  const crew: MockAccount[] = CREW.map((member, i) => ({
    ...base,
    id: member.id,
    username: member.username,
    full_name: member.full_name,
    role: 'astronaut' as const,
    last_login_at: member.call_sign === 'ATLAS' ? null : iso(t0 - (i + 2) * 3 * HOUR),
    // VEGA: bloqueado tras 5 intentos fallidos (para mostrar "Desbloquear").
    ...(member.call_sign === 'VEGA' ? { failed_login_attempts: 5, locked_until: iso(t0 + 45 * 60_000) } : {}),
    // ATLAS (m.silva): cambio de contraseña obligatorio, como en el seed.
    ...(member.call_sign === 'ATLAS' ? { must_change_password: true } : {}),
    astronaut: {
      id: member.astronaut_id,
      call_sign: member.call_sign,
      agency: 'Demo Agency',
      mission_id: MISSION_ID,
      crew_role: member.crew_role,
      assignment_id: `22000000-0000-4000-8000-0000000000${member.id.slice(-2)}`,
      assigned_from: created,
    },
  }));
  return [...ground, ...crew];
}

/** ¿Una cuenta guardada en localStorage tiene lo mínimo para usarla? */
export function isAccountRecord(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === 'string' &&
    typeof value.username === 'string' &&
    typeof value.full_name === 'string' &&
    typeof value.role === 'string' &&
    typeof value.created_at === 'string'
  );
}
