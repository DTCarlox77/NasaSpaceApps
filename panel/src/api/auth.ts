/** Autenticación (contrato: /auth/login, /auth/change-password, /auth/logout, /me). */
import { request } from './http.ts';
import { getDeviceId } from '../auth/storage.ts';
import type { LoginResponse, Me } from './types.ts';

export function login(username: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    auth: false,
    body: { username, password, device_id: getDeviceId() },
  });
}

/** Con el password_change_token del 428 (Bearer). Responde como un login completo. */
export function changePassword(
  passwordChangeToken: string,
  currentPassword: string,
  newPassword: string,
): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/change-password', {
    method: 'POST',
    token: passwordChangeToken,
    body: {
      current_password: currentPassword,
      new_password: newPassword,
      device_id: getDeviceId(),
    },
  });
}

/** Mejor esfuerzo: revoca el refresh token de este dispositivo; nunca falla. */
export async function logout(accessToken?: string | null): Promise<void> {
  try {
    await request<void>('/auth/logout', {
      method: 'POST',
      ...(accessToken ? { token: accessToken } : {}),
      body: { device_id: getDeviceId() },
      timeoutMs: 5_000,
    });
  } catch {
    // Si falla (red, token vencido), el refresh token expira solo.
  }
}

export const me = (): Promise<Me> => request<Me>('/me');
