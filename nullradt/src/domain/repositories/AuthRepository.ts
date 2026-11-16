import type { Credentials, Session } from '../entities/Session';

/** Autenticación contra el backend (o demo offline si no hay API configurada). */
export interface AuthRepository {
  /**
   * POST /auth/login. Errores: InvalidCredentialsError (401), AccountLockedError (423),
   * PasswordChangeRequiredError (428), NoActiveAssignmentError (403), RateLimitedError (429).
   */
  login(credentials: Credentials): Promise<Session>;
  /** POST /auth/change-password con el token del 428. Devuelve una sesión completa. */
  changePassword(changeToken: string, currentPassword: string, newPassword: string): Promise<Session>;
  /** POST /auth/logout (revoca el refresh de este dispositivo). Nunca falla: es de mejor esfuerzo. */
  logout(): Promise<void>;
  /** Despierta el servidor (GET /health con timeout largo). true = respondió. */
  wakeUp(): Promise<boolean>;
  /** Sesión de demostración (login desactivado). */
  demoSession(): Session;
}

/** Persistencia de la sesión en almacenamiento cifrado del dispositivo. */
export interface SessionRepository {
  save(session: Session): Promise<void>;
  load(): Promise<Session | null>;
  /** Borra la sesión y los tokens (el device_id se conserva). */
  clear(): Promise<void>;
  isBiometricEnabled(): Promise<boolean>;
  setBiometricEnabled(enabled: boolean): Promise<void>;
}
