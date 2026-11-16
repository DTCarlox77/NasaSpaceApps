import * as Haptics from 'expo-haptics';
import i18n from '@/core/i18n';
import { sendSystemNotification } from '@/core/notifications/notificationService';
import { speak } from '@/core/speech/speech';
import { useAuthStore } from '@/presentation/store/authStore';
import { useHealthLogStore, type CrewAlert } from '@/presentation/store/healthLogStore';
import { showToast } from '@/presentation/store/toastStore';

/**
 * Avisa a la tripulación (SIMULADO: sin backend se registra en el dispositivo y se notifica localmente;
 * con backend se enviaría por la red de la estación).
 */
export function alertCrew(input: Pick<CrewAlert, 'kind' | 'severity' | 'indicatorId' | 'value'>): CrewAlert {
  const session = useAuthStore.getState().session;
  const alert = useHealthLogStore.getState().addAlert({
    ...input,
    fromId: session?.userId ?? 'unknown',
    fromName: session?.displayName ?? '—',
  });
  const what = input.indicatorId ? i18n.t(`indicators.${input.indicatorId}.short`) : i18n.t('crew.sosLabel');
  const title = i18n.t('crew.alertSentTitle');
  const body = i18n.t('crew.alertSentBody', { what, value: input.value ?? '' });

  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  showToast({ level: input.severity, title, body });
  sendSystemNotification({ level: input.severity, title, body }).catch(() => {});
  speak(`${title}. ${body}`, i18n.language === 'es' ? 'es' : 'en', { chime: input.severity === 'critical' ? 'critical' : 'info' });
  return alert;
}

/** Cancela una alerta enviada por error y avisa a la tripulación. */
export function cancelCrewAlert(id: string) {
  useHealthLogStore.getState().cancelAlert(id);
  const title = i18n.t('crew.alertCancelledTitle');
  const body = i18n.t('crew.alertCancelledBody');
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  showToast({ level: 'normal', title, body });
  sendSystemNotification({ level: 'info', title, body }).catch(() => {});
  speak(title, i18n.language === 'es' ? 'es' : 'en');
}
