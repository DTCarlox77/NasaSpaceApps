import { apiEnabled } from '@/core/config/env';
import { type Credentials, type Session } from '@/domain/entities/Session';
import type { AuthRepository, SessionRepository } from '@/domain/repositories/AuthRepository';
import { healthCacheDataSource } from '../datasources/local/healthCacheDataSource';
import { sessionSecureDataSource } from '../datasources/local/sessionSecureDataSource';
import { triageLocalDataSource } from '../datasources/local/triageLocalDataSource';
import { sessionMockDataSource } from '../datasources/mock/sessionMockDataSource';
import { authRemoteDataSource } from '../datasources/remote/authRemoteDataSource';
import { onboardServer } from '../onboard/onboardServer';
import { useDeviceStore } from '@/presentation/store/deviceStore';

/**
 * Con EXPO_PUBLIC_API_URL: login real (POST /auth/login). Sin API: modo DEMO offline
 * (servidor a bordo simulado con la tripulación sintética, sesión `demo: true`) para la presentación.
 */
export class AuthRepositoryImpl implements AuthRepository {
  constructor(
    private readonly remote = authRemoteDataSource,
    private readonly mock = sessionMockDataSource,
  ) {}

  async login(credentials: Credentials): Promise<Session> {
    if (apiEnabled()) return this.remote.login(credentials);
    // Demo: servidor a bordo simulado (bcrypt + bloqueo + JWT/refresh rotativo, contraseñas temporales y PIN).
    await useDeviceStore.getState().ensure();
    return onboardServer.login(credentials.identifier, credentials.password, useDeviceStore.getState().deviceId);
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
