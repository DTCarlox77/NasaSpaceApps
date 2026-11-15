import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * Servicio de notificaciones LOCALES (no requieren internet ni servidor push).
 * Funciona en Expo Go. Las push remotas quedan fuera de este alcance.
 */

export type NotificationLevel = 'info' | 'normal' | 'caution' | 'critical';

export interface AppNotification {
  title: string;
  body: string;
  level: NotificationLevel;
}

export const ALERTS_CHANNEL = 'health-alerts';

export type PermissionState = 'granted' | 'undetermined' | 'denied' | 'blocked';

let configured: Promise<void> | null = null;

/**
 * Configuración global (llamar una vez al arrancar).
 * Con la app abierta NO mostramos el banner del sistema: el aviso lo pinta
 * la propia app desde arriba (ver ToastHost). Fuera de la app, el sistema lo muestra.
 */
export function configureNotifications(): Promise<void> {
  configured ??= doConfigure().catch((e) => {
    configured = null; // permitir reintento
    throw e;
  });
  return configured;
}

async function doConfigure() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ALERTS_CHANNEL, {
      name: 'Health alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 150, 250],
      lightColor: '#DE5149',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
}

const toState = (p: Notifications.NotificationPermissionsStatus): PermissionState => {
  if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
  if (p.status === 'undetermined') return 'undetermined';
  return p.canAskAgain ? 'denied' : 'blocked';
};

export async function getPermissionState(): Promise<PermissionState> {
  return toState(await Notifications.getPermissionsAsync());
}

export async function requestPermission(): Promise<PermissionState> {
  return toState(
    await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: true, allowCriticalAlerts: true },
    }),
  );
}

/** Si el usuario bloqueó el permiso, solo se puede activar desde los ajustes del sistema. */
export function openSystemSettings() {
  return Linking.openSettings();
}

/** Notificación del sistema. `delaySeconds` > 0 para programarla (útil para probar con la app en segundo plano). */
export async function sendSystemNotification(n: AppNotification, delaySeconds = 0) {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: n.title,
      body: n.body,
      sound: true,
      data: { level: n.level },
      priority: n.level === 'critical' ? Notifications.AndroidNotificationPriority.MAX : Notifications.AndroidNotificationPriority.HIGH,
    },
    trigger:
      delaySeconds > 0
        ? { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: delaySeconds, channelId: ALERTS_CHANNEL }
        : Platform.OS === 'android'
          ? { channelId: ALERTS_CHANNEL }
          : null,
  });
}

/** Escucha notificaciones que llegan con la app abierta (para mostrarlas in-app). */
export function onForegroundNotification(cb: (n: AppNotification) => void) {
  const sub = Notifications.addNotificationReceivedListener((event) => {
    const { title, body, data } = event.request.content;
    const level = (data?.level as NotificationLevel | undefined) ?? 'info';
    cb({ title: title ?? '', body: body ?? '', level });
  });
  return () => sub.remove();
}

/** Recordatorio diario local (funciona sin conexión y en Expo Go). Devuelve el id para cancelarlo. */
export function scheduleDailyReminder(title: string, body: string, hour: number, minute: number) {
  return Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true, data: { level: 'info' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: ALERTS_CHANNEL },
  });
}

export function cancelReminder(id: string) {
  return Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
}
