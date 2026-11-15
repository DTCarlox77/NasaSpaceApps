import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { apiEnabled } from '@/core/config/env';
import { palette, useAppTheme } from '@/core/theme';
import { speak, stopSpeaking } from '@/core/speech/speech';
import type { DeliveryResult, EmergencySessionInfo, ReportSeverity } from '@/domain/entities/EmergencyReport';
import { canCloseEmergency } from '@/domain/entities/Session';
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
import { useAuthStore } from '@/presentation/store/authStore';
import { showToast } from '@/presentation/store/toastStore';
import { refreshPendingCount, runSync } from '@/presentation/sync/syncEngine';

type Phase = 'idle' | 'sending' | DeliveryResult['status'] | 'cancelled';

/** Colores oscuros del semáforo para que el texto blanco del botón cumpla contraste. */
const HOLD_COLOR: Record<ReportSeverity, string> = {
  caution: palette.orange[600],
  critical: palette.red[600],
};

/**
 * Emergencia (agitar el teléfono o botón).
 * - Con API, CRÍTICO → POST /emergency/sessions (`manual_button`); si ya hay una abierta, te une a ella.
 *   Sin conexión → cola con prioridad `emergency` (se sube antes que todo).
 * - PRECAUCIÓN no es una emergencia: el contrato no tiene endpoint, queda solo en el dispositivo.
 * - Sin API (demo): aviso simulado a la tripulación, todo local.
 */
export default function AlertScreen() {
  const { t, i18n } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const { trigger } = useLocalSearchParams<{ trigger?: string }>();
  const mission = useMissionStatus();
  const session = useAuthStore((s) => s.session);
  const withApi = apiEnabled();
  const [severity, setSeverity] = useState<ReportSeverity>('critical');
  const [safe, setSafe] = useState<'yes' | 'no'>('yes');
  const [solar, setSolar] = useState<'yes' | 'no'>('no');
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState('');
  const [crewAlertId, setCrewAlertId] = useState<string | null>(null);
  const [emergency, setEmergency] = useState<EmergencySessionInfo | null>(null);
  /** Sesión para el triaje: id del servidor, o el client_uuid si quedó en cola / modo demo. */
  const [triageRef, setTriageRef] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
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
      responderSafe: severity === 'critical' ? safe === 'yes' : undefined,
      solarEventActive: severity === 'critical' ? solar === 'yes' : undefined,
    });
    setPhase(result.status);
    if (result.status === 'sent') setEmergency(result.session);
    if (severity === 'critical') setTriageRef(result.status === 'sent' && result.session ? result.session.id : result.report.id);
    if (result.status === 'queued') void refreshPendingCount();
    if (!withApi) {
      // Modo demo: la señal llega a la tripulación de forma simulada.
      setCrewAlertId(alertCrew({ kind: 'sos', severity }).id);
    }
    speak(
      result.status === 'sent'
        ? t('alert.voiceSent', { severity: t(`status.${severity}`) })
        : result.status === 'queued'
          ? t('alert.voiceQueued')
          : withApi
            ? t('alert.voiceLocal')
            : t('alert.voiceSent', { severity: t(`status.${severity}`) }),
      lang,
    );
    if (result.status === 'queued') void runSync();
  }, [severity, trigger, lang, mission?.missionDay, note, safe, solar, t, withApi]);

  const done = phase === 'sent' || phase === 'queued' || phase === 'local' || phase === 'cancelled';
  const canClose = withApi && phase === 'sent' && !!emergency && canCloseEmergency(session);

  /** Desactivar (si se envió por error): mantener 5 s. Con API solo comandante u oficial médico (falsa alarma). */
  const deactivate = async () => {
    if (!withApi) {
      if (crewAlertId) cancelCrewAlert(crewAlertId);
      setPhase('cancelled');
      return;
    }
    if (!emergency) return;
    setClosing(true);
    try {
      const res = await container.closeEmergency.execute(emergency.id, 'cancelled', t('alert.falseAlarmNote'));
      if (res === 'forbidden') showToast({ level: 'caution', title: t('alert.closeForbiddenTitle'), body: t('alert.closeForbidden') });
      else setPhase('cancelled');
    } catch {
      showToast({ level: 'caution', title: t('alert.closeErrorTitle'), body: t('errors.generic') });
    } finally {
      setClosing(false);
    }
  };

  const refresh = async () => {
    if (!emergency) return;
    const next = await container.getEmergencySession.execute(emergency.id);
    if (next) setEmergency({ ...next, joined: emergency.joined });
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const sentBody =
    phase === 'sent'
      ? emergency?.joined
        ? t('alert.joinedBody')
        : t('alert.sessionOpenBody')
      : phase === 'queued'
        ? t('alert.queuedBody')
        : withApi
          ? t('alert.localCautionBody')
          : t('alert.sentBody');

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
          <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
              {withApi && severity === 'caution' && <AppText variant="caption" color="textMuted">{t('alert.cautionLocalHint')}</AppText>}
            </View>

            {severity === 'critical' && (
              <View style={{ gap: spacing.sm }}>
                <AppText variant="title">{t('alert.solarEvent')}</AppText>
                <SegmentedControl<'yes' | 'no'>
                  value={solar}
                  onChange={setSolar}
                  options={[
                    { value: 'no', label: t('common.no') },
                    { value: 'yes', label: t('common.yes') },
                  ]}
                />
                <AppText variant="caption" color="textMuted">{t('alert.solarEventHint')}</AppText>
              </View>
            )}

            {severity === 'critical' && (
              <View style={{ gap: spacing.sm }}>
                <AppText variant="title">{t('alert.responderSafe')}</AppText>
                <SegmentedControl<'yes' | 'no'>
                  value={safe}
                  onChange={setSafe}
                  options={[
                    { value: 'yes', label: t('common.yes') },
                    { value: 'no', label: t('common.no') },
                  ]}
                />
              </View>
            )}

            <View style={{ gap: spacing.sm }}>
              <AppText variant="title">{t('alert.note')}</AppText>
              <VoiceNoteInput value={note} onChangeText={setNote} placeholder={t('alert.note')} />
              {withApi && <AppText variant="caption" color="textMuted">{t('alert.noteLocal')}</AppText>}
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
          <ScrollView contentContainerStyle={{ gap: spacing.xl }} showsVerticalScrollIndicator={false}>
          <Animated.View key={phase} entering={FadeIn.duration(250)} style={{ gap: spacing.xl }}>
            {phase === 'cancelled' ? (
              <Card tone="alt" style={[styles.center, { gap: spacing.md, paddingVertical: spacing.xxxl }]}>
                <Ionicons name="close-circle" size={64} color={colors.textMuted} />
                <AppText variant="h2" align="center">{t('alert.cancelledTitle')}</AppText>
                <AppText color="textSecondary" align="center">{t(withApi ? 'alert.cancelledServerBody' : 'alert.cancelledBody')}</AppText>
              </Card>
            ) : (
              <>
                <Card style={[styles.center, { gap: spacing.md, paddingVertical: spacing.xxl, backgroundColor: colors.status[severity].background, borderColor: colors.status[severity].ring, borderWidth: 1 }]}>
                  <Ionicons name={phase === 'local' && withApi ? 'phone-portrait-outline' : 'radio'} size={56} color={colors.status[severity].solid} />
                  <AppText variant="h2" align="center">
                    {phase === 'sent' ? t('alert.sessionOpenTitle') : phase === 'queued' ? t('alert.queuedTitle') : withApi ? t('alert.localTitle') : t('alert.signalSent')}
                  </AppText>
                  <AppText color="textSecondary" align="center">{sentBody}</AppText>
                  {(phase === 'sent' || !withApi) && (
                    <AppText variant="label" align="center" style={{ color: colors.status[severity].text }}>
                      {withApi ? t('alert.crewAndEarthNotified') : t('alert.crewNotified')}
                    </AppText>
                  )}
                </Card>

                {phase === 'sent' && emergency && (
                  <Card style={{ gap: spacing.sm }}>
                    {emergency.nextStep === 'secure_self' && (
                      <AppText variant="title" style={{ color: colors.status.critical.text }}>{t('alert.secureSelf')}</AppText>
                    )}
                    <InfoRow label={t('alert.sessionStatus')} value={t(`alert.statuses.${emergency.status}`)} />
                    <InfoRow label={t('alert.startedAt')} value={new Date(emergency.startedAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })} />
                    {emergency.roster.length > 0 && <InfoRow label={t('alert.roster')} value={emergency.roster.join(', ')} />}
                    <Button label={t('alert.refresh')} variant="outline" size="sm" leftIcon="refresh" onPress={refresh} />
                  </Card>
                )}

                {/* Triaje: la sesión que abrió (o a la que se unió) esta alerta. Funciona también sin conexión y en demo. */}
                {triageRef && (
                  <View style={{ gap: spacing.sm }}>
                    <Button
                      label={t('alert.startTriage')}
                      leftIcon="medkit"
                      size="lg"
                      variant="danger"
                      fullWidth
                      onPress={() => router.push({ pathname: '/triage/[sessionId]', params: { sessionId: triageRef } })}
                    />
                    <AppText variant="caption" color="textMuted" align="center">{t('alert.triageHint')}</AppText>
                  </View>
                )}

                {(!withApi || canClose) && (
                  <View style={[styles.center, { gap: spacing.sm }]}>
                    <HoldToConfirmButton
                      label={closing ? t('alert.sending') : t('alert.holdToDeactivate')}
                      hint={t('alert.deactivateHint')}
                      color={palette.neutral[700]}
                      icon="power"
                      size={150}
                      duration={5000}
                      disabled={closing}
                      onConfirm={deactivate}
                    />
                    <AppText variant="caption" color="textMuted" align="center">{t(withApi ? 'alert.deactivateServerHint' : 'alert.deactivateHint')}</AppText>
                  </View>
                )}
                {withApi && phase === 'sent' && !canClose && (
                  <AppText variant="caption" color="textMuted" align="center">{t('alert.closeOnlyLeads')}</AppText>
                )}
              </>
            )}
            <Button label={t('alert.close')} variant={phase === 'cancelled' ? 'primary' : 'outline'} onPress={close} fullWidth />
          </Animated.View>
          </ScrollView>
        )}

        <Disclaimer />
      </View>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <AppText variant="bodySmall" color="textMuted">{label}</AppText>
      <AppText variant="label" style={styles.infoValue}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  badge: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  infoValue: { flexShrink: 1, textAlign: 'right' },
});
