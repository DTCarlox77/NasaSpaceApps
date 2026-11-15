import { create } from 'zustand';
import { AccountLockedError, InvalidCredentialsError, type Credentials, type Session } from '@/domain/entities/Session';
import { env } from '@/core/config/env';
import { onboardServer } from '@/data/onboard/onboardServer';
import { sessionSecureDataSource } from '@/data/datasources/local/sessionSecureDataSource';
import i18n from '@/core/i18n';
import { container } from '@/di/container';
import { showToast } from './toastStore';

/**
 * loading   → leyendo la sesión guardada
 * signedOut → sin sesión: login con usuario y contraseña
 * locked    → hay sesión con desbloqueo local: huella / Face ID, PIN sin conexión (o contraseña)
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
    // Login desactivado (solo modo demo sin API): entrar directo con la sesión demo y datos de maqueta.
    if (!env.requireAuth) {
      set({ session: container.getDemoSession.execute(), biometricEnabled: false, status: 'unlocked' });
      return;
    }
    const { session, biometricEnabled } = await container.restoreSession.execute();
    // Una sesión demo guardada no sirve contra el servidor (ni una del servidor en modo demo).
    const usable = session && (env.apiUrl ? !session.demo : session.demo) ? session : null;
    set({
      session: usable,
      biometricEnabled: !!usable && biometricEnabled,
      status: !usable ? 'signedOut' : usable.mustChangePassword ? 'signedOut' : canLockLocally(usable, biometricEnabled) ? 'locked' : 'unlocked',
    });
  },

  verifyPassword: async (credentials, enableBiometric) => {
    const session = await container.signIn.execute(credentials, enableBiometric);
    set({ session, biometricEnabled: enableBiometric });
    // Al iniciar sesión: protocolo de triaje y reglas para poder evaluar sin conexión.
    if (!session.demo) void container.refreshOfflineData.execute({ force: true }).catch(() => {});
    return session;
  },

  changePassword: async (changeToken, currentPassword, newPassword) => {
    const session = await container.changePassword.execute(changeToken, currentPassword, newPassword);
    set({ session });
    if (!session.demo) void container.refreshOfflineData.execute({ force: true }).catch(() => {});
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

  signOut: async (remote = true) => {
    const s = get().session;
    if (s?.authMode === 'onboard') onboardServer.logout(s.refreshToken);
    await container.signOut.execute(remote);
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
