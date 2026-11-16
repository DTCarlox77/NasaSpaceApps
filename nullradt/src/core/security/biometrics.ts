import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Biometría del sistema (huella / Face ID / rostro / iris).
 * La app NO recibe ni guarda datos biométricos: el sistema operativo compara
 * contra lo registrado en el teléfono y solo responde éxito o fallo.
 *
 * Expo Go: huella funciona en Android. En iOS, Face ID no está disponible en
 * Expo Go (el sistema pide el código del iPhone); en un development build sí.
 */
export type BiometricKind = 'fingerprint' | 'face' | 'iris' | 'generic';

export interface BiometricCapability {
  /** Hay sensor y el usuario tiene al menos una huella/rostro registrado. */
  available: boolean;
  hasHardware: boolean;
  enrolled: boolean;
  kind: BiometricKind;
}

export async function getBiometricCapability(): Promise<BiometricCapability> {
  try {
    const [hasHardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const T = LocalAuthentication.AuthenticationType;
    const kind: BiometricKind = types.includes(T.FACIAL_RECOGNITION)
      ? types.includes(T.FINGERPRINT)
        ? 'generic'
        : 'face'
      : types.includes(T.FINGERPRINT)
        ? 'fingerprint'
        : types.includes(T.IRIS)
          ? 'iris'
          : 'generic';
    return { available: hasHardware && enrolled, hasHardware, enrolled, kind };
  } catch {
    return { available: false, hasHardware: false, enrolled: false, kind: 'generic' };
  }
}

export type BiometricResult = { ok: true } | { ok: false; reason: 'cancel' | 'lockout' | 'notAvailable' | 'failed' };

export async function authenticateBiometric(promptMessage: string, cancelLabel: string): Promise<BiometricResult> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel,
      // Permitimos el PIN/patrón del teléfono como respaldo si la biometría falla varias veces.
      disableDeviceFallback: false,
    });
    if (res.success) return { ok: true };
    const error = res.error;
    if (error === 'user_cancel' || error === 'system_cancel' || error === 'app_cancel') return { ok: false, reason: 'cancel' };
    if (error === 'lockout') return { ok: false, reason: 'lockout' };
    if (error === 'not_enrolled' || error === 'not_available' || error === 'passcode_not_set') return { ok: false, reason: 'notAvailable' };
    return { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
