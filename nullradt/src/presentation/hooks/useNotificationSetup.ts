import { useEffect } from 'react';
import { configureNotifications, getPermissionState, requestPermission } from '@/core/notifications/notificationService';

/**
 * Al iniciar: configura el canal y pide el permiso de notificaciones UNA vez
 * (solo si el usuario aún no decidió). No bloquea la app.
 */
export function useNotificationSetup() {
  useEffect(() => {
    (async () => {
      await configureNotifications(); // Android 13+: el canal debe existir antes de pedir permiso
      if ((await getPermissionState()) === 'undetermined') await requestPermission();
    })().catch(() => {});
  }, []);
}
