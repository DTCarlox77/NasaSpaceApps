import { create } from 'zustand';
import { AccountLockedError, InvalidCredentialsError, type Credentials, type Session } from '@/domain/entities/Session';
import { env } from '@/core/config/env';
import { onboardServer } from '@/data/onboard/onboardServer';
import { sessionSecureDataSource } from '@/data/datasources/local/sessionSecureDataSource';
import { container } from '@/di/container';

/**
 * loading   → leyendo la sesión guardada
 * signedOut → sin sesión: login con ID y contraseña
 * locked    → hay sesión con desbloqueo local: huella / Face ID, PIN sin conexión (o contraseña)
 * unlocked  → dentro de la app
 *
 * El login tiene 2 pasos (Figma): 1) identificarse  2) elegir misión.
 * Si la contraseña es temporal, antes hay que cambiarla.
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
  /** Reemplaza la sesión (rotación de tokens, PIN, cambio de contraseña) y la guarda cifrada. */
  updateSession: (patch: Partial<Session>) => Promise<void>;
  /** Desbloqueo con PIN sin conexión (solo hasta offlineUnlockUntil). */
  unlockWithPin: (pin: string) => Promise<void>;
  hasPin: () => boolean;
}

/** El PIN offline caducó: hay que validar con contraseña contra el servidor. */
export class OfflineUnlockExpiredError extends Error {
  constructor() {
    super('offline-unlock-expired');
  }
}

const canLockLocally = (session: Session | null, biometric: boolean) =>
  !!session && session.authMode !== 'demoAuto' && (biometric || onboardServer.hasPin(session.userId));

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  session: null,
  biometricEnabled: false,

  bootstrap: async () => {
    const { session, biometricEnabled } = await container.restoreSession.execute();
    // Login desactivado: entrar directo con la sesión demo, salvo que ya haya una sesión real guardada.
    if (!env.requireAuth && (!session || session.authMode === 'demoAuto')) {
      set({ session: container.getDemoSession.execute(), biometricEnabled: false, status: 'unlocked' });
      return;
    }
    set({
      session,
      biometricEnabled,
      status: !session ? 'signedOut' : canLockLocally(session, biometricEnabled) ? 'locked' : session.mustChangePassword ? 'signedOut' : 'unlocked',
    });
  },

  verifyPassword: async (credentials, enableBiometric) => {
    const session = await container.signIn.execute(credentials, enableBiometric);
    set({ session, biometricEnabled: enableBiometric });
    return session;
  },

  enterApp: () => {
    const s = get().session;
    if (s && !s.mustChangePassword) set({ status: 'unlocked' });
  },

  lock: () => {
    const { session, biometricEnabled, status } = get();
    if (status === 'unlocked' && canLockLocally(session, biometricEnabled)) set({ status: 'locked' });
  },

  signOut: async () => {
    onboardServer.logout(get().session?.refreshToken);
    await container.signOut.execute();
    set({ session: null, biometricEnabled: false, status: 'signedOut' });
  },

  setBiometricEnabled: async (enabled) => {
    await container.setBiometricUnlock.execute(enabled);
    set({ biometricEnabled: enabled });
  },

  updateSession: async (patch) => {
    const current = get().session;
    if (!current) return;
    const session = { ...current, ...patch };
    set({ session });
    if (session.authMode !== 'demoAuto') await sessionSecureDataSource.save(session);
  },

  unlockWithPin: async (pin) => {
    const s = get().session;
    if (!s) throw new InvalidCredentialsError();
    if (!s.offlineUnlockUntil || new Date(s.offlineUnlockUntil).getTime() < Date.now()) throw new OfflineUnlockExpiredError();
    try {
      await onboardServer.verifyPin(s.userId, pin);
    } catch (e) {
      if (e instanceof AccountLockedError) throw e;
      throw new InvalidCredentialsError();
    }
    set({ status: 'unlocked' });
  },

  hasPin: () => {
    const s = get().session;
    return !!s && onboardServer.hasPin(s.userId);
  },
}));
