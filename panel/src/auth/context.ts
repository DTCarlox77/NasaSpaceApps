import { createContext, useContext } from 'react';
import type { GroundRole, MissionRef, UserContext, UserSummary } from '../api/types.ts';

export type AuthStatus = 'restoring' | 'anonymous' | 'authenticated';

export type SignInResult =
  | { kind: 'ok' }
  | { kind: 'password_change' }
  | { kind: 'error'; message: string };

export interface PendingPasswordChange {
  token: string;
  username: string;
}

export interface AuthState {
  status: AuthStatus;
  user: UserSummary | null;
  context: UserContext | null;
  role: GroundRole | null;
  /** Aviso para la pantalla de login (p. ej. la sesión terminó). */
  notice: string | null;
  /** Error de red al recuperar la sesión (no la cierra). */
  restoreError: string | null;
  pendingPasswordChange: PendingPasswordChange | null;
  mission: MissionRef | null;
}

export interface AuthActions {
  signIn(username: string, password: string): Promise<SignInResult>;
  completePasswordChange(currentPassword: string, newPassword: string): Promise<SignInResult>;
  cancelPasswordChange(): void;
  signOut(): Promise<void>;
  retryRestore(): void;
  selectMission(id: string): void;
  clearNotice(): void;
}

export type AuthValue = AuthState & AuthActions;

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return value;
}
