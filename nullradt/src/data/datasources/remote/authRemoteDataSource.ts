import { env } from '@/core/config/env';
import { InvalidCredentialsError, type Credentials, type CrewRole, type Session } from '@/domain/entities/Session';
import { onboardServer } from '@/data/onboard/onboardServer';
import { useDeviceStore } from '@/presentation/store/deviceStore';
import { HttpError, postJson } from './httpClient';

interface LoginResponse {
  token: string;
  user: { id: string; name: string; role: CrewRole };
}

/**
 * Contrato con el backend:
 *   POST /api/v1/auth/login   Body: { identifier, password }
 *   200 → { token, user: { id, name, role } }   401 → credenciales inválidas
 *
 * Sin EXPO_PUBLIC_API_URL: modo DEMO offline (ID + contraseña de prueba de la tripulación sintética,
 * sesión marcada como `demo: true`). Sirve para la presentación sin servidor.
 */
export const authRemoteDataSource = {
  async login(credentials: Credentials): Promise<Session> {
    if (!env.apiUrl) {
      // Demo: servidor a bordo simulado (bcrypt + bloqueo + JWT/refresh rotativo).
      await useDeviceStore.getState().ensure();
      return onboardServer.login(credentials.identifier, credentials.password, useDeviceStore.getState().deviceId);
    }
    try {
      const res = await postJson<LoginResponse>('/api/v1/auth/login', credentials);
      if (!res) throw new HttpError('empty response');
      return {
        userId: res.user.id,
        displayName: res.user.name,
        role: res.user.role,
        token: res.token,
        issuedAt: new Date().toISOString(),
        demo: false,
        authMode: 'remote',
      };
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) throw new InvalidCredentialsError();
      throw e;
    }
  },
};
