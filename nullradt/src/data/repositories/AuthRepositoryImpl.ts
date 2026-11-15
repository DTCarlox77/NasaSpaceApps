import { apiEnabled } from '@/core/config/env';
import { InvalidCredentialsError, type Credentials, type Session } from '@/domain/entities/Session';
import type { AuthRepository, SessionRepository } from '@/domain/repositories/AuthRepository';
import { healthCacheDataSource } from '../datasources/local/healthCacheDataSource';
import { sessionSecureDataSource } from '../datasources/local/sessionSecureDataSource';
import { triageLocalDataSource } from '../datasources/local/triageLocalDataSource';
import { crewMockDataSource } from '../datasources/mock/crewMockDataSource';
import { sessionMockDataSource } from '../datasources/mock/sessionMockDataSource';
import { authRemoteDataSource } from '../datasources/remote/authRemoteDataSource';

/**
 * Con EXPO_PUBLIC_API_URL: login real (POST /auth/login). Sin API: modo DEMO offline
 * (ID + contraseña de prueba de la tripulación sintética, sesión `demo: true`) para la presentación.
 */
export class AuthRepositoryImpl implements AuthRepository {
  constructor(
    private readonly remote = authRemoteDataSource,
    private readonly mock = sessionMockDataSource,
    private readonly crew = crewMockDataSource,
  ) {}

  async login(credentials: Credentials): Promise<Session> {
    if (apiEnabled()) return this.remote.login(credentials);
    const member = this.crew.verify(credentials.identifier, credentials.password);
    if (!member) throw new InvalidCredentialsError();
    return {
      userId: member.id,
      displayName: member.displayName,
      role: member.role,
      token: `demo-token-${Date.now().toString(36)}`,
      issuedAt: new Date().toISOString(),
      demo: true,
    };
  }

  changePassword(changeToken: string, currentPassword: string, newPassword: string): Promise<Session> {
    return this.remote.changePassword(changeToken, currentPassword, newPassword);
  }

  async logout(): Promise<void> {
    if (apiEnabled()) await this.remote.logout();
  }

  async wakeUp(): Promise<boolean> {
    return apiEnabled() ? this.remote.wakeUp() : false;
  }

  demoSession(): Session {
    return this.mock.demoSession();
  }
}

export class SessionRepositoryImpl implements SessionRepository {
  constructor(private readonly local = sessionSecureDataSource) {}

  save(session: Session) {
    return this.local.save(session);
  }
  load() {
    return this.local.load();
  }
  async clear() {
    // Datos de salud en caché (propios y del triaje de la tripulación): se borran al cerrar sesión
    // (la cola de sync se conserva por dueño; los protocolos y reglas no son datos personales y se quedan).
    await Promise.all([this.local.clear(), healthCacheDataSource.clear().catch(() => {}), triageLocalDataSource.clear()]);
  }
  isBiometricEnabled() {
    return this.local.isBiometricEnabled();
  }
  setBiometricEnabled(enabled: boolean) {
    return this.local.setBiometricEnabled(enabled);
  }
}
