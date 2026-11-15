/**
 * Roles GLOBALES (cuenta): control de misión (admin), flight surgeon, salud conductual y astronauta.
 * Comandante y oficial médico NO son roles globales: son `crewRole` dentro de la misión.
 */
export type GlobalRole = 'admin' | 'flight_surgeon' | 'behavioral_health' | 'astronaut';
export type MissionCrewRole = 'commander' | 'medical_officer' | 'crew';
/** Compatibilidad con código previo. */
export type CrewRole = GlobalRole;

export interface Credentials {
  /** ID de tripulante o correo. */
  identifier: string;
  password: string;
}

export interface Session {
  userId: string;
  displayName: string;
  role: GlobalRole;
  crewRole?: MissionCrewRole;
  missionId?: string;
  /** JWT de acceso (vida corta). */
  token: string;
  /** Refresh token rotativo (un solo uso; reutilizarlo revoca toda la familia). */
  refreshToken?: string;
  accessExpiresAt?: string;
  issuedAt: string; // ISO 8601
  /** true = sesión de demostración sin backend (datos sintéticos). */
  demo: boolean;
  /** demoAuto = entrada directa sin login · onboard = servidor a bordo (simulado) · remote = backend. */
  authMode?: 'demoAuto' | 'onboard' | 'remote';
  /** Contraseña temporal: hay que cambiarla antes de entrar. */
  mustChangePassword?: boolean;
  /** Hasta cuándo se puede desbloquear con PIN sin conexión con el servidor (ISO). */
  offlineUnlockUntil?: string;
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('invalid-credentials');
  }
}

/** Demasiados intentos fallidos: cuenta bloqueada hasta `until`. */
export class AccountLockedError extends Error {
  constructor(public readonly until: number) {
    super('account-locked');
  }
}

/** Se presentó un refresh token ya usado: posible robo → se revoca toda la familia de sesiones. */
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

export class WeakPasswordError extends Error {
  constructor() {
    super('weak-password');
  }
}
