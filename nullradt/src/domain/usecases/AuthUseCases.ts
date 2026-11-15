import { InvalidCredentialsError, type Credentials, type Session } from '../entities/Session';
import type { AuthRepository, SessionRepository } from '../repositories/AuthRepository';

export class SignIn {
  constructor(
    private readonly auth: AuthRepository,
    private readonly sessions: SessionRepository,
  ) {}

  async execute(credentials: Credentials, enableBiometric: boolean): Promise<Session> {
    const identifier = credentials.identifier.trim();
    if (!identifier || !credentials.password) throw new InvalidCredentialsError();
    const session = await this.auth.login({ identifier, password: credentials.password });
    await this.sessions.save(session);
    await this.sessions.setBiometricEnabled(enableBiometric);
    return session;
  }
}

export interface RestoredSession {
  session: Session | null;
  biometricEnabled: boolean;
}

export class RestoreSession {
  constructor(private readonly sessions: SessionRepository) {}

  async execute(): Promise<RestoredSession> {
    const [session, biometricEnabled] = await Promise.all([this.sessions.load(), this.sessions.isBiometricEnabled()]);
    return { session, biometricEnabled: !!session && biometricEnabled };
  }
}

export class SignOut {
  constructor(private readonly sessions: SessionRepository) {}

  async execute(): Promise<void> {
    await this.sessions.clear();
    await this.sessions.setBiometricEnabled(false);
  }
}

export class SetBiometricUnlock {
  constructor(private readonly sessions: SessionRepository) {}

  execute(enabled: boolean): Promise<void> {
    return this.sessions.setBiometricEnabled(enabled);
  }
}

/** Sesión demo para usar la app sin login (datos de maqueta). */
export class GetDemoSession {
  constructor(private readonly auth: AuthRepository) {}

  execute(): Session {
    return this.auth.demoSession();
  }
}
