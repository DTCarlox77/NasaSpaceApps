import { useEffect } from 'react';
import { router, usePathname } from 'expo-router';
import { container } from '@/di/container';
import { useShakeDetector } from './useShakeDetector';

/**
 * Comportamiento global de alertas:
 * - Agitar el teléfono abre la pantalla de alerta (salvo si ya está abierta).
 * - Al iniciar la app, reintenta enviar los informes que quedaron en cola offline.
 */
export function useShakeToAlert() {
  const pathname = usePathname();
  const onAlertScreen = pathname === '/alert';

  useShakeDetector(() => router.push({ pathname: '/alert', params: { trigger: 'shake' } }), {
    enabled: !onAlertScreen,
  });

  useEffect(() => {
    container.flushPendingReports.execute().catch(() => {});
  }, []);
}
