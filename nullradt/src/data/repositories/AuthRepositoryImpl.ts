import type { Credentials, Session } from '@/domain/entities/Session';
import type { AuthRepository, SessionRepository } from '@/domain/repositories/AuthRepository';
import { sessionSecureDataSource } from '../datasources/local/sessionSecureDataSource';
import { sessionMockDataSource } from '../datasources/mock/sessionMockDataSource';
import { authRemoteDataSource } from '../datasources/remote/authRemoteDataSource';

export class AuthRepositoryImpl implements AuthRepository {
  constructor(
    private readonly remote = authRemoteDataSource,
    private readonly mock = sessionMockDataSource,
  ) {}

  login(credentials: Credentials): Promise<Session> {
    return this.remote.login(credentials);
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
  clear() {
    return this.local.clear();
  }
  isBiometricEnabled() {
    return this.local.isBiometricEnabled();
  }
  setBiometricEnabled(enabled: boolean) {
    return this.local.setBiometricEnabled(enabled);
  }
}
