import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { palette, useAppTheme } from '@/core/theme';
import { speak, stopSpeaking } from '@/core/speech/speech';
import type { DeliveryResult, ReportSeverity } from '@/domain/entities/EmergencyReport';
import { container } from '@/di/container';
import {
  AppText,
  Button,
  Card,
  HoldToConfirmButton,
  IconButton,
  SegmentedControl,
  VoiceNoteInput,
} from '@/presentation/components/ui';
import { Disclaimer } from '@/presentation/components/feedback/Disclaimer';
import { useMissionStatus } from '@/presentation/hooks/useMissionStatus';
import { alertCrew, cancelCrewAlert } from '@/presentation/features/crew/crewAlerts';

type Phase = 'idle' | 'sending' | DeliveryResult['status'] | 'cancelled';

/** Colores oscuros del semáforo para que el texto blanco del botón cumpla contraste. */
const HOLD_COLOR: Record<ReportSeverity, string> = {
  caution: palette.orange[600],
  critical: palette.red[600],
};

export default function AlertScreen() {
  const { t, i18n } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const { trigger } = useLocalSearchParams<{ trigger?: string }>();
  const mission = useMissionStatus();
  const [severity, setSeverity] = useState<ReportSeverity>('critical');
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState('');
  const [crewAlertId, setCrewAlertId] = useState<string | null>(null);
  const lang = i18n.language === 'es' ? 'es' : 'en';

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    speak(t('alert.voiceIntro'), lang, { chime: 'critical' });
    return stopSpeaking;
    // Solo al abrir la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback(async () => {
    setPhase('sending');
    const result = await container.sendEmergencyReport.execute({
      severity,
      trigger: trigger === 'shake' ? 'shake' : 'manual',
      language: lang,
      missionDay: mission?.missionDay,
      note: note.trim() || undefined,
    });
    setPhase(result.status);
    // La señal también llega a la tripulación (simulado sin backend).
    setCrewAlertId(alertCrew({ kind: 'sos', severity }).id);
    speak(
      result.status === 'sent'
        ? t('alert.voiceSent', { severity: t(`status.${severity}`) })
        : t('alert.voiceQueued'),
      lang,
    );
  }, [severity, trigger, lang, mission?.missionDay, note, t]);

  const done = phase === 'sent' || phase === 'queued' || phase === 'cancelled';

  /** Desactivar (si se envió por error): mantener 5 s. */
  const deactivate = () => {
    if (crewAlertId) cancelCrewAlert(crewAlertId);
    setPhase('cancelled');
  };
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={[styles.flex, { padding: spacing.lg, gap: spacing.xl }]}>
        <View style={[styles.row, { gap: spacing.md }]}>
          <View style={[styles.badge, { backgroundColor: colors.status.critical.background, borderRadius: radius.pill }]}>
            <Ionicons name="warning" size={22} color={colors.status.critical.text} />
          </View>
          <AppText variant="h2" style={styles.flex}>{t('alert.title')}</AppText>
          <IconButton icon="close" tone="filled" accessibilityLabel={t('alert.close')} onPress={close} />
        </View>

        {trigger === 'shake' && (
          <AppText variant="caption" color="textMuted">{t('alert.openedByShake')}</AppText>
        )}

        {!done ? (
          <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ flexGrow: 1 }}
          >
          <Animated.View entering={FadeIn} style={[styles.flex, { gap: spacing.xl }]}>
            <AppText color="textSecondary">{t('alert.subtitle')}</AppText>

            <View style={{ gap: spacing.sm }}>
              <AppText variant="title">{t('alert.severity')}</AppText>
              <SegmentedControl<ReportSeverity>
                value={severity}
                onChange={setSeverity}
                options={[
                  { value: 'caution', label: t('status.caution') },
                  { value: 'critical', label: t('status.critical') },
                ]}
              />
            </View>

            <View style={{ gap: spacing.sm }}>
              <AppText variant="title">{t('alert.note')}</AppText>
              <VoiceNoteInput value={note} onChangeText={setNote} placeholder={t('alert.note')} />
            </View>

            <View style={[styles.center, styles.flex, { gap: spacing.md, paddingVertical: spacing.lg }]}>
              <HoldToConfirmButton
                label={phase === 'sending' ? t('alert.sending') : t('alert.holdToSend')}
                hint={t('alert.holdHint')}
                color={HOLD_COLOR[severity]}
                icon={severity === 'critical' ? 'alert' : 'warning-outline'}
                disabled={phase === 'sending'}
                duration={1000}
                onConfirm={send}
              />
              <AppText variant="caption" color="textMuted" align="center">{t('alert.holdHint')}</AppText>
            </View>

            <Button label={t('alert.cancel')} variant="ghost" onPress={close} />
          </Animated.View>
          </ScrollView>
          </KeyboardAvoidingView>
        ) : (
          <Animated.View key={phase} entering={FadeIn.duration(250)} style={[styles.flex, { gap: spacing.xl }]}>
            {phase === 'cancelled' ? (
              <Card tone="alt" style={[styles.center, { gap: spacing.md, paddingVertical: spacing.xxxl }]}>
                <Ionicons name="close-circle" size={64} color={colors.textMuted} />
                <AppText variant="h2" align="center">{t('alert.cancelledTitle')}</AppText>
                <AppText color="textSecondary" align="center">{t('alert.cancelledBody')}</AppText>
              </Card>
            ) : (
              <>
                <Card style={[styles.center, { gap: spacing.md, paddingVertical: spacing.xxl, backgroundColor: colors.status.critical.background, borderColor: colors.status.critical.ring, borderWidth: 1 }]}>
                  <Ionicons name="radio" size={56} color={colors.status.critical.solid} />
                  <AppText variant="h2" align="center">{t('alert.signalSent')}</AppText>
                  <AppText color="textSecondary" align="center">
                    {phase === 'sent' ? t('alert.sentBody') : t('alert.queuedBody')}
                  </AppText>
                  <AppText variant="label" align="center" style={{ color: colors.status.critical.text }}>{t('alert.crewNotified')}</AppText>
                </Card>
                <View style={[styles.center, { gap: spacing.sm }]}>
                  <HoldToConfirmButton
                    label={t('alert.holdToDeactivate')}
                    hint={t('alert.deactivateHint')}
                    color={palette.neutral[700]}
                    icon="power"
                    size={150}
                    duration={5000}
                    onConfirm={deactivate}
                  />
                  <AppText variant="caption" color="textMuted" align="center">{t('alert.deactivateHint')}</AppText>
                </View>
              </>
            )}
            <Button label={t('alert.close')} variant={phase === 'cancelled' ? 'primary' : 'outline'} onPress={close} fullWidth />
          </Animated.View>
        )}

        <Disclaimer />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  badge: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
