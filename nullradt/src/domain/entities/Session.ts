/** Rol de la app (textos en i18n `auth.roles.*`). Se deriva de `role` + `context.crew_role` del servidor. */
export type CrewRole = 'astronaut' | 'crew' | 'flightSurgeon';

/**
 * Rol GLOBAL de la cuenta (sin `service`): control de misión (admin), flight surgeon, salud conductual y astronauta.
 * Comandante y oficial médico NO son roles globales: son `crewRole` dentro de la misión.
 */
export type GlobalRole = Exclude<AccountRole, 'service'>;

/** Rol de tripulación del servidor (`context.crew_role`). */
export type MissionCrewRole = 'commander' | 'pilot' | 'crew_medical_officer' | 'flight_engineer' | 'mission_specialist';

/** Rol de cuenta del servidor (`user.role`). */
export type AccountRole = 'astronaut' | 'flight_surgeon' | 'behavioral_health' | 'admin' | 'service';

export interface Credentials {
  /** Demo: ID de tripulante (NR-A-0000). Con API: usuario del servidor (p. ej. a.ortega). */
  identifier: string;
  password: string;
}

/** Misión vigente que asigna el servidor (el astronauta nunca la elige). */
export interface SessionMission {
  id: string;
  code: string;
  name: string;
  status: string;
}

export interface SessionEnvironment {
  code: string;
  name: string;
  type?: string;
  gravityG: number;
  commDelaySeconds: number;
}

/**
 * Sesión del dispositivo. Los tokens NO viven aquí: se guardan aparte en el almacén seguro
 * (ver `sessionSecureDataSource`). `token` solo se usa en la sesión demo.
 */
export interface Session {
  userId: string;
  displayName: string;
  role: CrewRole;
  /** Demo: misión elegida en el paso 2. Con API la misión viene en `mission`. */
  missionId?: string;
  /** JWT de acceso (vida corta). */
  token: string;
  /** Refresh token rotativo (un solo uso; reutilizarlo revoca toda la familia). */
  refreshToken?: string;
  accessExpiresAt?: string;
  issuedAt: string; // ISO 8601
  /** true = sesión de demostración sin backend (datos sintéticos). */
  demo: boolean;
  username?: string;
  accountRole?: AccountRole;
  astronautId?: string | null;
  callSign?: string | null;
  crewRole?: MissionCrewRole | null;
  /** Sexo biológico para referencias clínicas (solo el propio astronauta lo recibe). */
  sex?: 'female' | 'male' | null;
  mission?: SessionMission | null;
  environment?: SessionEnvironment | null;
  /** Hasta cuándo puede desbloquear sin conexión con PIN (ISO). Con API: `offline_unlock_until`. */
  offlineUnlockUntil?: string | null;
  /** demoAuto = entrada directa sin login · onboard = servidor a bordo simulado (modo demo) · remote = backend real. */
  authMode?: 'demoAuto' | 'onboard' | 'remote';
  /** Solo modo demo a bordo: contraseña temporal que hay que cambiar antes de entrar (con API es el 428). */
  mustChangePassword?: boolean;
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('invalid-credentials');
  }
}

/** 423 ACCOUNT_LOCKED: `lockedUntil` en ISO 8601. */
export class AccountLockedError extends Error {
  constructor(readonly lockedUntil: string | null) {
    super('account-locked');
  }
}

/** Se presentó un refresh token ya usado (servidor a bordo simulado). Con API llega como SessionExpiredError('reuse'). */
export class TokenReuseError extends Error {
  constructor() {
    super('refresh-token-reuse');
  }
}

export class PermissionDeniedError extends Error {
  constructor() {
    super('permission-denied');
  }
}

/** 428 PASSWORD_CHANGE_REQUIRED: token de un solo uso para POST /auth/change-password. */
export class PasswordChangeRequiredError extends Error {
  constructor(
    readonly changeToken: string,
    readonly expiresIn: number | null,
  ) {
    super('password-change-required');
  }
}

/** 403 NO_ACTIVE_ASSIGNMENT: astronauta sin misión vigente. */
export class NoActiveAssignmentError extends Error {
  constructor() {
    super('no-active-assignment');
  }
}

/** 429 RATE_LIMITED. */
export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number | null) {
    super('rate-limited');
  }
}

/** 400 WEAK_PASSWORD (cambio de contraseña). */
export class WeakPasswordError extends Error {
  constructor(readonly minLength: number | null) {
    super('weak-password');
  }
}

/** La sesión del servidor ya no sirve (refresh fallido o reuso detectado): hay que volver al login. */
export class SessionExpiredError extends Error {
  constructor(readonly reason: 'expired' | 'reuse' = 'expired') {
    super('session-expired');
  }
}

/**
 * Mapea el rol de la app desde `user.role` + `context.crew_role` del servidor:
 * astronauta (cualquier `crew_role`) → 'astronaut' · flight_surgeon → 'flightSurgeon' · resto del personal → 'crew'.
 * Lo específico de a bordo (comandante, oficial médico…) se lee de `crewRole`, no de este valor.
 */
export function appRoleFrom(accountRole: AccountRole, crewRole: MissionCrewRole | null | undefined): CrewRole {
  if (accountRole === 'astronaut' || crewRole) return 'astronaut';
  if (accountRole === 'flight_surgeon') return 'flightSurgeon';
  return 'crew';
}

/** Comandante u oficial médico: los únicos que pueden cerrar una emergencia (contrato). */
export const canCloseEmergency = (s: Pick<Session, 'crewRole'> | null | undefined) =>
  s?.crewRole === 'commander' || s?.crewRole === 'crew_medical_officer';

/** Rol global de la sesión (para permisos y visibilidad). */
export function globalRoleOf(s: Pick<Session, 'role' | 'accountRole'>): GlobalRole {
  if (s.accountRole && s.accountRole !== 'service') return s.accountRole;
  return s.role === 'flightSurgeon' ? 'flight_surgeon' : 'astronaut';
}
