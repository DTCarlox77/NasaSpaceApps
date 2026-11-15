import { env } from '@/core/config/env';
import { InvalidCredentialsError, type Credentials, type CrewRole, type Session } from '@/domain/entities/Session';
import { crewMockDataSource } from '../mock/crewMockDataSource';
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
      // Demo: ID y contraseña de prueba de la tripulación sintética.
      const member = crewMockDataSource.verify(credentials.identifier, credentials.password);
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
      };
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) throw new InvalidCredentialsError();
      throw e;
    }
  },
};
