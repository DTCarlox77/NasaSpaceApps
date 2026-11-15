import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { apiEnabled } from '@/core/config/env';
import i18n from '@/core/i18n';
import { sendSystemNotification } from '@/core/notifications/notificationService';
import { container } from '@/di/container';

/**
 * Monitoreo en segundo plano (offline-first).
 * Cada ~15 min (mínimo del sistema operativo), aunque la app esté cerrada:
 *  1) sincroniza la cola offline con el servidor (POST /sync/push + GET /sync/pull),
 *  2) consulta el estado de salud y, si hay un indicador CRÍTICO nuevo, avisa con una notificación del sistema.
 * Importante: `defineTask` debe ejecutarse al cargar el módulo (por eso se importa en el layout raíz).
 */
export const HEALTH_MONITOR_TASK = 'nullradt-health-monitor';
const NOTIFIED_KEY = 'nullradt-bg-notified';

TaskManager.defineTask(HEALTH_MONITOR_TASK, async () => {
  try {
    // Sube la cola offline (emergencias primero) y baja lo nuevo, si hay sesión con servidor.
    const { session } = await container.restoreSession.execute();
    if (apiEnabled() && session && !session.demo) await container.syncNow.execute(session.userId).catch(() => null);
    const overview = await container.getHealthOverview.execute();
    if (overview.snapshot.origin === 'mock') return BackgroundTask.BackgroundTaskResult.Success;

    const notified: string[] = JSON.parse((await AsyncStorage.getItem(NOTIFIED_KEY)) ?? '[]');
    const fresh = overview.indicators.filter(
      (i) => i.status === 'critical' && i.latest && !notified.includes(`${i.id}@${i.latest.takenAt}`),
    );
    for (const ind of fresh) {
      await sendSystemNotification({
        level: 'critical',
        title: i18n.t('background.criticalTitle', { indicator: i18n.t(`indicators.${ind.id}.short`) }),
        body: i18n.t('background.criticalBody'),
      });
      notified.push(`${ind.id}@${ind.latest!.takenAt}`);
    }
    await AsyncStorage.setItem(NOTIFIED_KEY, JSON.stringify(notified.slice(-50)));
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export type MonitorState = 'active' | 'expoGo' | 'restricted' | 'error';

/** Registra la tarea (idempotente). En Expo Go no está disponible: requiere APK / development build. */
export async function registerBackgroundMonitor(): Promise<MonitorState> {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return 'expoGo';
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return 'restricted';
    if (!(await TaskManager.isTaskRegisteredAsync(HEALTH_MONITOR_TASK))) {
      await BackgroundTask.registerTaskAsync(HEALTH_MONITOR_TASK, { minimumInterval: 15 });
    }
    return 'active';
  } catch {
    return 'error';
  }
}
