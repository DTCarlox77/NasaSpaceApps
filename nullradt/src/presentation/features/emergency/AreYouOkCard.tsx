import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { speak } from '@/core/speech/speech';
import type { ConfirmOkOutcome } from '@/domain/entities/EmergencyReport';
import { container } from '@/di/container';
import { AppText, Button, Card } from '@/presentation/components/ui';

const secondsLeft = (deadline: string | null) => (deadline ? Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 1000)) : null);

/**
 * "¿Estás bien?" (guía §10): una lectura crítica abrió una emergencia automática (`status: pending`).
 * Cuenta regresiva hasta `deadline_at`; "Estoy bien" → POST /emergency/sessions/{id}/confirm.
 * Si nadie responde a tiempo, el servidor activa la emergencia y avisa a la tripulación y a Tierra.
 */
export function AreYouOkCard({ sessionId, deadlineAt }: { sessionId: string; deadlineAt: string | null }) {
  const { t, i18n } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const [left, setLeft] = useState(() => secondsLeft(deadlineAt));
  const [state, setState] = useState<'waiting' | 'sending' | ConfirmOkOutcome | 'error'>('waiting');

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    speak(t('areYouOk.voice'), i18n.language === 'es' ? 'es' : 'en', { chime: 'critical' });
    if (!deadlineAt) return;
    const timer = setInterval(() => setLeft(secondsLeft(deadlineAt)), 1000);
    return () => clearInterval(timer);
    // Solo al aparecer la tarjeta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineAt]);

  const confirm = async () => {
    setState('sending');
    try {
      setState(await container.confirmOk.execute(sessionId));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch {
      setState('error');
    }
  };

  const done = state === 'confirmed' || state === 'expired' || state === 'queued';
  const expired = state === 'expired' || (left === 0 && !done);

  return (
    <Card style={[styles.center, { gap: spacing.md, backgroundColor: colors.status.critical.background, borderColor: colors.status.critical.ring, borderWidth: 1 }]}>
      <Ionicons name={done ? 'checkmark-circle' : 'help-buoy'} size={44} color={colors.status.critical.solid} />
      <AppText variant="h2" align="center">{t('areYouOk.title')}</AppText>
      {!done && (
        <AppText align="center" color="textSecondary">
          {expired ? t('areYouOk.expiredBody') : left !== null ? t('areYouOk.countdown', { seconds: left }) : t('areYouOk.body')}
        </AppText>
      )}
      {done && <AppText align="center" color="textSecondary">{t(`areYouOk.result.${state}`)}</AppText>}
      {state === 'error' && <AppText variant="bodySmall" color="dangerText" align="center">{t('areYouOk.error')}</AppText>}
      {!done && (
        <View style={styles.full}>
          <Button label={t('areYouOk.imOk')} leftIcon="hand-right-outline" size="lg" fullWidth loading={state === 'sending'} onPress={confirm} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center' },
  full: { alignSelf: 'stretch' },
});
