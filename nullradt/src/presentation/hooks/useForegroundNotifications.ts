import { useEffect } from 'react';
import { onForegroundNotification } from '@/core/notifications/notificationService';
import { showToast } from '@/presentation/store/toastStore';

/** Notificaciones del sistema que llegan con la app abierta → se muestran como aviso in-app. */
export function useForegroundNotifications() {
  useEffect(() => onForegroundNotification(showToast), []);
}
