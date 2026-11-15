import { router, usePathname } from 'expo-router';
import { useShakeDetector } from './useShakeDetector';

/**
 * Comportamiento global de alertas: agitar el teléfono abre la pantalla de alerta (salvo si ya está abierta).
 * La cola offline (incluidas las emergencias, que van primero) la sube el ciclo de sincronización (`useSyncLoop`).
 */
export function useShakeToAlert() {
  const pathname = usePathname();
  const onAlertScreen = pathname === '/alert';

  useShakeDetector(() => router.push({ pathname: '/alert', params: { trigger: 'shake' } }), {
    enabled: !onAlertScreen,
  });
}
