import * as SecureStore from 'expo-secure-store';
import type { Session } from '@/domain/entities/Session';

/**
 * Sesión en almacenamiento CIFRADO del sistema:
 * - iOS: Keychain · Android: Keystore (EncryptedSharedPreferences).
 * Nunca se guarda la contraseña: solo el token de sesión.
 * Las huellas/rostros NUNCA salen del sensor del teléfono; la app solo recibe "aprobado / rechazado".
 */
const SESSION_KEY = 'nullradt.session';
const BIOMETRIC_KEY = 'nullradt.biometricUnlock';
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const sessionSecureDataSource = {
  async save(session: Session) {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), OPTIONS);
  },
  async load(): Promise<Session | null> {
    try {
      const raw = await SecureStore.getItemAsync(SESSION_KEY, OPTIONS);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  },
  async clear() {
    await SecureStore.deleteItemAsync(SESSION_KEY, OPTIONS);
  },
  async isBiometricEnabled() {
    return (await SecureStore.getItemAsync(BIOMETRIC_KEY, OPTIONS)) === '1';
  },
  async setBiometricEnabled(enabled: boolean) {
    if (enabled) await SecureStore.setItemAsync(BIOMETRIC_KEY, '1', OPTIONS);
    else await SecureStore.deleteItemAsync(BIOMETRIC_KEY, OPTIONS);
  },
};
