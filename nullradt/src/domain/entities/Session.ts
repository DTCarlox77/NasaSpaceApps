export type CrewRole = 'astronaut' | 'crew' | 'flightSurgeon';

export interface Credentials {
  /** ID de tripulante o correo. */
  identifier: string;
  password: string;
}

export interface Session {
  userId: string;
  displayName: string;
  role: CrewRole;
  token: string;
  issuedAt: string; // ISO 8601
  /** true = sesión de demostración sin backend (datos sintéticos). */
  demo: boolean;
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('invalid-credentials');
  }
}
