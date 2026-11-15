import { create } from 'zustand';
import type { Credentials, Session } from '@/domain/entities/Session';
import { env } from '@/core/config/env';
import { container } from '@/di/container';

/**
 * loading   → leyendo la sesión guardada
 * signedOut → sin sesión: login con ID y contraseña
 * locked    → hay sesión con desbloqueo biométrico: login con huella / Face ID (o contraseña)
 * unlocked  → dentro de la app
 *
 * El login tiene 2 pasos (Figma): 1) identificarse  2) elegir misión.
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
  /** Paso final: abre la app. */
  enterApp: () => void;
  lock: () => void;
  signOut: () => Promise<void>;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  session: null,
  biometricEnabled: false,

  bootstrap: async () => {
    // Login desactivado (por ahora): entrar directo con la sesión demo y datos de maqueta.
    if (!env.requireAuth) {
      set({ session: container.getDemoSession.execute(), biometricEnabled: false, status: 'unlocked' });
      return;
    }
    const { session, biometricEnabled } = await container.restoreSession.execute();
    set({
      session,
      biometricEnabled,
      status: !session ? 'signedOut' : biometricEnabled ? 'locked' : 'unlocked',
    });
  },

  verifyPassword: async (credentials, enableBiometric) => {
    const session = await container.signIn.execute(credentials, enableBiometric);
    set({ session, biometricEnabled: enableBiometric });
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

  signOut: async () => {
    await container.signOut.execute();
    set({ session: null, biometricEnabled: false, status: 'signedOut' });
  },

  setBiometricEnabled: async (enabled) => {
    await container.setBiometricUnlock.execute(enabled);
    set({ biometricEnabled: enabled });
  },
}));
