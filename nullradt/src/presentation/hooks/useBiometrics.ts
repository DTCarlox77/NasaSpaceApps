import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  authenticateBiometric,
  getBiometricCapability,
  type BiometricCapability,
  type BiometricKind,
} from '@/core/security/biometrics';

export const BIOMETRIC_ICON: Record<BiometricKind, 'finger-print' | 'scan' | 'eye' | 'shield-checkmark'> = {
  fingerprint: 'finger-print',
  face: 'scan',
  iris: 'eye',
  generic: 'shield-checkmark',
};

/** Capacidad biométrica del dispositivo + acción de autenticar con textos traducidos. */
export function useBiometrics() {
  const { t } = useTranslation();
  const [capability, setCapability] = useState<BiometricCapability | null>(null);

  useEffect(() => {
    getBiometricCapability().then(setCapability);
  }, []);

  const authenticate = useCallback(
    () => authenticateBiometric(t('auth.biometricPrompt'), t('alert.cancel')),
    [t],
  );

  const kind = capability?.kind ?? 'generic';
  return {
    capability,
    available: !!capability?.available,
    kind,
    icon: BIOMETRIC_ICON[kind],
    methodLabel: t(`auth.method.${kind}`),
    /** Igual pero con mayúscula inicial (para títulos y segmentos). */
    methodLabelTitle: t(`auth.methodTitle.${kind}`),
    authenticate,
  };
}
