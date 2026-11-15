import { useEffect, useState } from 'react';
import { onboardServer } from '@/data/onboard/onboardServer';
import { useAuthStore } from '@/presentation/store/authStore';
import { useDeviceStore } from '@/presentation/store/deviceStore';

export interface EmergencyAccess {
  allowed: boolean;
  /** session = usuario con sesión · device = emergencia sin sesión en tableta registrada · none = sin acceso */
  mode: 'session' | 'device' | 'none';
  /** Quién figura como activador del triaje. */
  actor: string;
  checking: boolean;
}

/**
 * Acceso al triaje:
 * - con sesión desbloqueada → siempre;
 * - SIN sesión → solo en tabletas registradas (credencial de dispositivo verificada contra el servidor a bordo).
 *   Esa credencial abre el triaje y nada más (no da acceso a datos médicos ni de bienestar).
 */
export function useEmergencyAccess(): EmergencyAccess {
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.session?.userId);
  const deviceId = useDeviceStore((s) => s.deviceId);
  const [device, setDevice] = useState<{ ok: boolean; checked: boolean }>({ ok: false, checked: false });

  useEffect(() => {
    if (status === 'unlocked') return;
    let alive = true;
    (async () => {
      await useDeviceStore.getState().ensure();
      const id = useDeviceStore.getState().deviceId;
      const ok = await useDeviceStore.getState().verifyCredential(onboardServer.deviceFingerprint(id));
      if (ok) onboardServer.logEmergencyAccess(id);
      if (alive) setDevice({ ok, checked: true });
    })();
    return () => {
      alive = false;
    };
  }, [status]);

  if (status === 'unlocked' && userId) return { allowed: true, mode: 'session', actor: userId, checking: false };
  return { allowed: device.ok, mode: device.ok ? 'device' : 'none', actor: `device:${deviceId}`, checking: !device.checked };
}
