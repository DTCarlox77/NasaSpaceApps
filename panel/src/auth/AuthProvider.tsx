/**
 * Sesión del panel: user, context y rol del equipo en Tierra.
 * - Al cargar, si hay refresh_token en sessionStorage, pide un access token nuevo
 *   (POST /auth/refresh). Un error de red no cierra la sesión: muestra "Reintentar".
 * - Login: un rol que no es de Tierra (astronauta) se rechaza (logout de mejor esfuerzo).
 *   428 → cambio de contraseña con el password_change_token.
 * - Logout: POST /auth/logout de mejor esfuerzo, borra tokens, sesión y la caché de React Query.
 * - Si el refresh falla (TOKEN_REUSE_DETECTED u otro 401), el cliente HTTP avisa y se vuelve
 *   al login con "Tu sesión terminó. Inicia sesión de nuevo.".
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as authApi from '../api/auth.ts';
import { HttpError, refreshAccessToken } from '../api/http.ts';
import { isGroundRole, type LoginResponse } from '../api/types.ts';
import { MISSION_DATA } from '../api/queryKeys.ts';
import * as storage from './storage.ts';
import { AuthContext, type AuthState, type AuthValue, type SignInResult } from './context.ts';
import {
  ASTRONAUT_MESSAGE,
  SESSION_ENDED_MESSAGE,
  changePasswordErrorMessage,
  loginErrorMessage,
} from './messages.ts';

const ANONYMOUS: AuthState = {
  status: 'anonymous',
  user: null,
  context: null,
  role: null,
  notice: null,
  restoreError: null,
  pendingPasswordChange: null,
  mission: null,
};

function initialState(): AuthState {
  return storage.loadSession() ? { ...ANONYMOUS, status: 'restoring' } : ANONYMOUS;
}

function authenticated(session: storage.StoredSession): AuthState {
  const role = session.user.role;
  return {
    ...ANONYMOUS,
    status: 'authenticated',
    user: session.user,
    context: session.context,
    role: isGroundRole(role) ? role : null,
    mission: storage.pickMission(session.context.ground_missions),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>(initialState);
  const [restoreAttempt, setRestoreAttempt] = useState(0);

  // Recuperar la sesión al recargar (una vez por intento).
  useEffect(() => {
    const stored = storage.loadSession();
    if (!stored) return;
    let cancelled = false;
    refreshAccessToken()
      .then(() => {
        if (cancelled) return;
        const current = storage.loadSession();
        setState(current && isGroundRole(current.user.role) ? authenticated(current) : ANONYMOUS);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof HttpError) {
          setState({ ...ANONYMOUS, notice: SESSION_ENDED_MESSAGE });
        } else {
          setState((s) => ({
            ...s,
            status: 'restoring',
            restoreError: 'No se pudo conectar con el servidor para recuperar tu sesión.',
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [restoreAttempt]);

  // El cliente HTTP avisa cuando el refresh falla: volver al login.
  useEffect(
    () =>
      storage.onSessionEnded((reason) => {
        queryClient.clear();
        setState({ ...ANONYMOUS, notice: reason === 'expired' ? SESSION_ENDED_MESSAGE : null });
      }),
    [queryClient],
  );

  const acceptLogin = useCallback(async (data: LoginResponse): Promise<SignInResult> => {
    if (!isGroundRole(data.user.role)) {
      // El backend aceptó, pero el panel no es para este rol: cerrar esa sesión.
      await authApi.logout(data.access_token);
      storage.clearSession();
      setState(ANONYMOUS);
      return { kind: 'error', message: ASTRONAUT_MESSAGE };
    }
    const session = { refresh_token: data.refresh_token, user: data.user, context: data.context };
    storage.saveSession(session, data.access_token);
    setState(authenticated(session));
    return { kind: 'ok' };
  }, []);

  const signIn = useCallback(
    async (username: string, password: string): Promise<SignInResult> => {
      try {
        return await acceptLogin(await authApi.login(username, password));
      } catch (err) {
        if (err instanceof HttpError && err.code === 'PASSWORD_CHANGE_REQUIRED') {
          const details = err.details as { password_change_token?: string; role?: string } | null;
          const token = details?.password_change_token;
          // Si el 428 dice el rol (solo el modo demo; el contrato v1.8 no lo trae), un astronauta
          // se rechaza aquí, antes de cambiar en el panel una contraseña que es de la app.
          if (details?.role && !isGroundRole(details.role)) {
            return { kind: 'error', message: ASTRONAUT_MESSAGE };
          }
          if (token) {
            setState({ ...ANONYMOUS, pendingPasswordChange: { token, username } });
            return { kind: 'password_change' };
          }
        }
        return { kind: 'error', message: loginErrorMessage(err) };
      }
    },
    [acceptLogin],
  );

  const completePasswordChange = useCallback(
    async (currentPassword: string, newPassword: string): Promise<SignInResult> => {
      const pending = state.pendingPasswordChange;
      if (!pending) {
        return { kind: 'error', message: 'Inicia sesión de nuevo para cambiar la contraseña.' };
      }
      try {
        return await acceptLogin(
          await authApi.changePassword(pending.token, currentPassword, newPassword),
        );
      } catch (err) {
        const message = changePasswordErrorMessage(err);
        if (err instanceof HttpError && err.code === 'UNAUTHENTICATED') {
          setState({ ...ANONYMOUS, notice: message });
        }
        return { kind: 'error', message };
      }
    },
    [acceptLogin, state.pendingPasswordChange],
  );

  const signOut = useCallback(async () => {
    // Por el cliente HTTP: con el access token vencido, refresca y reintenta una vez.
    await authApi.logout();
    storage.clearSession();
    queryClient.clear();
    setState(ANONYMOUS);
  }, [queryClient]);

  const value = useMemo<AuthValue>(
    () => ({
      ...state,
      signIn,
      completePasswordChange,
      signOut,
      cancelPasswordChange: () => setState(ANONYMOUS),
      retryRestore: () => {
        setState((s) => ({ ...s, restoreError: null }));
        setRestoreAttempt((n) => n + 1);
      },
      selectMission: (id: string) => {
        const next = state.context?.ground_missions?.find((m) => m.id === id);
        if (!next || next.id === state.mission?.id) return;
        storage.setSelectedMissionId(id);
        // Fuera los datos de la misión anterior (dashboard, bandeja, enlace…).
        queryClient.removeQueries({ queryKey: [MISSION_DATA] });
        setState((s) => ({ ...s, mission: next }));
      },
      clearNotice: () => setState((s) => ({ ...s, notice: null })),
    }),
    [state, signIn, completePasswordChange, signOut, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
