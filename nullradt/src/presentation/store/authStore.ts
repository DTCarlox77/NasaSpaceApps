import { create } from 'zustand';
import type { Credentials, Session } from '@/domain/entities/Session';
import { env } from '@/core/config/env';
import i18n from '@/core/i18n';
import { container } from '@/di/container';
import { showToast } from './toastStore';

/**
 * loading   → leyendo la sesión guardada
 * signedOut → sin sesión: login con usuario y contraseña
 * locked    → hay sesión con desbloqueo biométrico: login con huella / Face ID (o contraseña)
 * unlocked  → dentro de la app
 *
 * El login tiene 2 pasos (Figma): 1) identificarse  2) misión (con API la asigna el servidor; solo se muestra).
 * Por eso "verificar" y "entrar" son acciones separadas.
 */
export type AuthStatus = 'loading' | 'signedOut' | 'locked' | 'unlocked';

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  biometricEnabled: boolean;
  bootstrap: () => Promise<void>;
  /** Paso 1 con contraseña: valida, guarda la sesión cifrada y la preferencia biométrica. No entra todavía. */
  verifyPassword: (credentials: Credentials, enableBiometric: boolean) => Promise<Session>;
  /** 428 en el login: cambia la contraseña con el token de un solo uso y deja la sesión iniciada. */
  changePassword: (changeToken: string, currentPassword: string, newPassword: string) => Promise<Session>;
  /** Paso final: abre la app. */
  enterApp: () => void;
  lock: () => void;
  /** `remote = false` cuando el servidor ya cerró la sesión (refresh fallido o reuso del token). */
  signOut: (remote?: boolean) => Promise<void>;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  session: null,
  biometricEnabled: false,

  bootstrap: async () => {
    // Login desactivado (solo modo demo sin API): entrar directo con la sesión demo y datos de maqueta.
    if (!env.requireAuth) {
      set({ session: container.getDemoSession.execute(), biometricEnabled: false, status: 'unlocked' });
      return;
    }
    const { session, biometricEnabled } = await container.restoreSession.execute();
    // Una sesión demo guardada no sirve contra el servidor.
    const usable = session && (!env.apiUrl || !session.demo) ? session : null;
    set({
      session: usable,
      biometricEnabled: !!usable && biometricEnabled,
      status: !usable ? 'signedOut' : biometricEnabled ? 'locked' : 'unlocked',
    });
  },

  verifyPassword: async (credentials, enableBiometric) => {
    const session = await container.signIn.execute(credentials, enableBiometric);
    set({ session, biometricEnabled: enableBiometric });
    return session;
  },

  changePassword: async (changeToken, currentPassword, newPassword) => {
    const session = await container.changePassword.execute(changeToken, currentPassword, newPassword);
    set({ session });
    return session;
  },

  enterApp: () => {
    if (get().session) set({ status: 'unlocked' });
  },

  lock: () => {
    if (!env.requireAuth) return;
    const { session, biometricEnabled, status } = get();
    if (session && biometricEnabled && status === 'unlocked') set({ status: 'locked' });
  },

  signOut: async (remote = true) => {
    await container.signOut.execute(remote);
    set({ session: null, biometricEnabled: false, status: 'signedOut' });
  },

  setBiometricEnabled: async (enabled) => {
    await container.setBiometricUnlock.execute(enabled);
    set({ biometricEnabled: enabled });
  },
}));

// Refresh fallido o 401 TOKEN_REUSE_DETECTED: el servidor ya revocó la sesión → volver al login.
container.onSessionExpired((reason) => {
  if (!useAuthStore.getState().session) return;
  void useAuthStore.getState().signOut(false);
  showToast({
    level: 'caution',
    title: i18n.t('auth.sessionExpiredTitle'),
    body: i18n.t(reason === 'reuse' ? 'auth.sessionReuseBody' : 'auth.sessionExpiredBody'),
  });
});
