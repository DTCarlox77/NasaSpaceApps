import * as SecureStore from 'expo-secure-store';
import type { Session } from '@/domain/entities/Session';
import { newUuid } from '@/domain/usecases/uuid';

/**
 * Sesión y credenciales en almacenamiento CIFRADO del sistema:
 * - iOS: Keychain · Android: Keystore (EncryptedSharedPreferences).
 * Nunca se guarda la contraseña. Los tokens (access + refresh rotativo) van SOLO aquí, en claves aparte.
 * Las huellas/rostros NUNCA salen del sensor del teléfono; la app solo recibe "aprobado / rechazado".
 */
const SESSION_KEY = 'nullradt.session';
const BIOMETRIC_KEY = 'nullradt.biometricUnlock';
const ACCESS_KEY = 'nullradt.accessToken';
const REFRESH_KEY = 'nullradt.refreshToken';
const DEVICE_KEY = 'nullradt.deviceId';
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

let deviceIdCache: string | null = null;

const read = async (key: string) => {
  try {
    return await SecureStore.getItemAsync(key, OPTIONS);
  } catch {
    return null;
  }
};

export const sessionSecureDataSource = {
  async save(session: Session) {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), OPTIONS);
  },
  async load(): Promise<Session | null> {
    const raw = await read(SESSION_KEY);
    try {
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  },
  async clear() {
    await Promise.all([
      SecureStore.deleteItemAsync(SESSION_KEY, OPTIONS),
      SecureStore.deleteItemAsync(ACCESS_KEY, OPTIONS),
      SecureStore.deleteItemAsync(REFRESH_KEY, OPTIONS),
    ]);
  },
  async isBiometricEnabled() {
    return (await read(BIOMETRIC_KEY)) === '1';
  },
  async setBiometricEnabled(enabled: boolean) {
    if (enabled) await SecureStore.setItemAsync(BIOMETRIC_KEY, '1', OPTIONS);
    else await SecureStore.deleteItemAsync(BIOMETRIC_KEY, OPTIONS);
  },

  /** Tokens del servidor. El refresh es rotativo: siempre se guardan LOS DOS juntos. */
  async getTokens(): Promise<TokenPair | null> {
    const [accessToken, refreshToken] = await Promise.all([read(ACCESS_KEY), read(REFRESH_KEY)]);
    return accessToken && refreshToken ? { accessToken, refreshToken } : null;
  },
  async setTokens(tokens: TokenPair) {
    await SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken, OPTIONS);
    await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken, OPTIONS);
  },
  async clearTokens() {
    await Promise.all([SecureStore.deleteItemAsync(ACCESS_KEY, OPTIONS), SecureStore.deleteItemAsync(REFRESH_KEY, OPTIONS)]);
  },

  /** `device_id` estable: UUID generado una sola vez y guardado en el almacén seguro (sobrevive al logout). */
  async getDeviceId(): Promise<string> {
    if (deviceIdCache) return deviceIdCache;
    const stored = await read(DEVICE_KEY);
    if (stored) return (deviceIdCache = stored);
    const id = `app-${newUuid()}`;
    await SecureStore.setItemAsync(DEVICE_KEY, id, OPTIONS).catch(() => {});
    return (deviceIdCache = id);
  },
};
