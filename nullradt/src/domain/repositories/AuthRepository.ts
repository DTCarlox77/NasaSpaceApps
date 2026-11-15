import type { Credentials, Session } from '../entities/Session';

/** Autenticación contra el backend (o demo offline si no hay API configurada). */
export interface AuthRepository {
  login(credentials: Credentials): Promise<Session>;
  /** Sesión de demostración (login desactivado). */
  demoSession(): Session;
}

/** Persistencia de la sesión en almacenamiento cifrado del dispositivo. */
export interface SessionRepository {
  save(session: Session): Promise<void>;
  load(): Promise<Session | null>;
  clear(): Promise<void>;
  isBiometricEnabled(): Promise<boolean>;
  setBiometricEnabled(enabled: boolean): Promise<void>;
}
