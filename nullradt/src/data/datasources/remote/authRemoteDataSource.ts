import { env } from '@/core/config/env';
import {
  AccountLockedError,
  appRoleFrom,
  InvalidCredentialsError,
  NoActiveAssignmentError,
  PasswordChangeRequiredError,
  RateLimitedError,
  WeakPasswordError,
  type Credentials,
  type Session,
} from '@/domain/entities/Session';
import { sessionSecureDataSource } from '../local/sessionSecureDataSource';
import type { ApiLoginResponse } from './apiTypes';
import { HttpError, postJson, wakeServer } from './httpClient';

/** Convierte la respuesta del login (o del cambio de contraseña) en la sesión de la app. */
function toSession(res: ApiLoginResponse): Session {
  const c = res.context;
  return {
    userId: res.user.id,
    username: res.user.username,
    displayName: c.call_sign ? `${c.call_sign} · ${res.user.full_name}` : res.user.full_name,
    role: appRoleFrom(res.user.role, c.crew_role),
    accountRole: res.user.role,
    token: '',
    issuedAt: new Date().toISOString(),
    demo: false,
    astronautId: c.astronaut_id,
    callSign: c.call_sign,
    crewRole: c.crew_role,
    sex: c.sex ?? null,
    mission: c.mission ? { id: c.mission.id, code: c.mission.code, name: c.mission.name ?? c.mission.code, status: c.mission.status } : null,
    environment: c.environment
      ? {
          code: c.environment.code,
          name: c.environment.name ?? c.environment.code,
          type: c.environment.type,
          gravityG: c.environment.gravity_g,
          commDelaySeconds: c.environment.comm_delay_seconds,
        }
      : null,
    offlineUnlockUntil: res.offline_unlock_until ?? null,
  };
}

/** Errores del contrato → errores del dominio (se programa contra `code`, nunca contra `message`). */
function mapAuthError(e: unknown): unknown {
  if (!(e instanceof HttpError)) return e;
  const details = (e.details ?? {}) as Record<string, unknown>;
  switch (e.code) {
    case 'INVALID_CREDENTIALS':
      return new InvalidCredentialsError();
    case 'ACCOUNT_LOCKED':
      return new AccountLockedError(typeof details.locked_until === 'string' ? details.locked_until : null);
    case 'PASSWORD_CHANGE_REQUIRED':
      return new PasswordChangeRequiredError(
        String(details.password_change_token ?? ''),
        typeof details.expires_in === 'number' ? details.expires_in : null,
      );
    case 'NO_ACTIVE_ASSIGNMENT':
      return new NoActiveAssignmentError();
    case 'RATE_LIMITED':
      return new RateLimitedError(e.retryAfterSeconds ?? (typeof details.retry_after_seconds === 'number' ? details.retry_after_seconds : null));
    case 'WEAK_PASSWORD':
      return new WeakPasswordError(typeof details.min_length === 'number' ? details.min_length : null);
  }
  // 401 sin código conocido: siempre "usuario o contraseña incorrectos" (no se revela si existe).
  if (e.status === 401 || e.status === 400) return new InvalidCredentialsError();
  return e;
}

/**
 * Contrato (OpenAPI v1.6):
 *   POST /auth/login { username, password, device_id } → tokens + context (misión y crew_role)
 *   POST /auth/change-password (Bearer = password_change_token del 428) → igual que el login
 *   POST /auth/logout { device_id } → 204
 */
export const authRemoteDataSource = {
  async login(credentials: Credentials): Promise<Session> {
    const deviceId = await sessionSecureDataSource.getDeviceId();
    try {
      const res = await postJson<ApiLoginResponse>(
        '/auth/login',
        { username: credentials.identifier.trim().toLowerCase(), password: credentials.password, device_id: deviceId },
        // Timeout largo: si Render estaba dormido, el login puede ser la petición que lo despierta.
        { auth: false, timeoutMs: env.apiWakeTimeoutMs },
      );
      if (!res?.access_token) throw new HttpError('empty response');
      await sessionSecureDataSource.setTokens({ accessToken: res.access_token, refreshToken: res.refresh_token });
      return toSession(res);
    } catch (e) {
      throw mapAuthError(e);
    }
  },

  async changePassword(changeToken: string, currentPassword: string, newPassword: string): Promise<Session> {
    const deviceId = await sessionSecureDataSource.getDeviceId();
    try {
      const res = await postJson<ApiLoginResponse>(
        '/auth/change-password',
        { current_password: currentPassword, new_password: newPassword, device_id: deviceId },
        { bearer: changeToken },
      );
      if (!res?.access_token) throw new HttpError('empty response');
      await sessionSecureDataSource.setTokens({ accessToken: res.access_token, refreshToken: res.refresh_token });
      return toSession(res);
    } catch (e) {
      throw mapAuthError(e);
    }
  },

  async logout(): Promise<void> {
    try {
      const deviceId = await sessionSecureDataSource.getDeviceId();
      // `retried`: sin refresh automático (si el token venció no hay nada que revocar con él).
      await postJson('/auth/logout', { device_id: deviceId, all_devices: false }, { timeoutMs: 8000, retried: true });
    } catch {
      // Mejor esfuerzo: sin red el refresh vence solo; los tokens se borran del dispositivo igual.
    }
  },

  wakeUp: wakeServer,
};
