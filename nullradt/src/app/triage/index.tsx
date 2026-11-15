import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { palette, useAppTheme } from '@/core/theme';
import { speak } from '@/core/speech/speech';
import { isBlackout, LINK_PROFILES } from '@/domain/comms/linkModel';
import { evaluateTriage, PROTOCOL, type TriageCategory } from '@/domain/triage/evaluator';
import { Disclaimer } from '@/presentation/components/feedback/Disclaimer';
import { BackHeader } from '@/presentation/components/navigation/BackHeader';
import { Avatar, AppText, Button, Card, FadeInView, HoldToConfirmButton, PressableScale, Screen } from '@/presentation/components/ui';
import { markActivity } from '@/presentation/features/triage/DeadManSwitch';
import { sendTriageReport } from '@/presentation/features/triage/triageReport';
import { useEmergencyAccess } from '@/presentation/features/access/useEmergencyAccess';
import { useCrew } from '@/presentation/hooks/useCrew';
import { formatDuration, useNow } from '@/presentation/hooks/useNow';
import { messageStatus, useOutboxStore } from '@/presentation/store/outboxStore';
import { showToast } from '@/presentation/store/toastStore';
import { useTriageStore, type TriageTrigger } from '@/presentation/store/triageStore';

const TRIGGERS: TriageTrigger[] = ['manual', 'criticalReading', 'missedCheckIn', 'crewEvent', 'deadMan', 'deviceEmergency', 'sos'];

/**
 * TRIAJE AUTÓNOMO DE TRIPULACIÓN — tablero.
 * Funciona sin Tierra: reglas START versionadas en el dispositivo, voz y botones grandes.
 * Prioriza a quién atender y envía el reporte completo a Tierra cuando el enlace lo permite.
 */
export default function TriageBoardScreen() {
  const { t, i18n } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const params = useLocalSearchParams<{ trigger?: TriageTrigger }>();
  const { crew } = useCrew();
  const access = useEmergencyAccess();
  const active = useTriageStore((s) => s.active);
  const start = useTriageStore((s) => s.start);
  const close = useTriageStore((s) => s.close);
  const messages = useOutboxStore((s) => s.messages);
  const profile = useOutboxStore((s) => s.profile);
  const forcedOffline = useOutboxStore((s) => s.forcedOffline);
  const now = useNow(1000);
  const lang = i18n.language === 'es' ? 'es' : 'en';
  const autoStarted = useRef(false);

  const activate = (trigger: TriageTrigger) => {
    if (!access.allowed) return;
    start(trigger, access.actor);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    speak(t('triage.voiceStart'), lang, { chime: 'critical' });
    markActivity();
  };

  // Activación automática (lectura crítica, check-in perdido, evento de tripulación…).
  useEffect(() => {
    if (autoStarted.current || active || !params.trigger || !access.allowed) return;
    autoStarted.current = true;
    activate(TRIGGERS.includes(params.trigger) ? params.trigger : 'manual');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.trigger, access.allowed]);

  const rows = useMemo(
    () =>
      crew
        .map((m) => {
          const p = active?.patients[m.id];
          return { m, p, ev: p ? evaluateTriage(p.answers) : null };
        })
        .sort((a, b) => (a.ev?.priority ?? 50) - (b.ev?.priority ?? 50)),
    [crew, active],
  );

  const lastReport = active?.reports[active.reports.length - 1];
  const reportMsg = lastReport ? messages.find((m) => m.id === lastReport.messageId) : undefined;
  const reportStatus = reportMsg ? messageStatus(reportMsg, now) : null;
  const linkDown = isBlackout(now, LINK_PROFILES[profile], forcedOffline);

  const tone = (c: TriageCategory) => {
    const k = PROTOCOL.categories[c].tone;
    return k === 'black' ? { bg: colors.night, fg: colors.onNight, ring: colors.night } : { bg: colors.status[k as 'critical'].solid, fg: k === 'normal' ? colors.onPrimary : '#FFFFFF', ring: colors.status[k as 'critical'].ring };
  };

  if (!access.allowed) {
    return (
      <Screen>
        <BackHeader title={t('triage.title')} />
        <Card style={{ gap: spacing.md }}>
          <Ionicons name="lock-closed" size={32} color={colors.textMuted} />
          <AppText variant="h3">{t('triage.noAccessTitle')}</AppText>
          <AppText color="textSecondary">{t('triage.noAccessBody')}</AppText>
          <Button label={t('triage.basicSos')} variant="danger" leftIcon="megaphone" onPress={() => router.replace({ pathname: '/alert', params: { trigger: 'manual' } })} />
        </Card>
      </Screen>
    );
  }

  if (!active) {
    return (
      <Screen>
        <BackHeader title={t('triage.title')} subtitle={t('triage.subtitle')} />
        {access.mode === 'device' && (
          <Card tone="alt" style={[styles.row, { gap: spacing.sm }]}>
            <Ionicons name="tablet-portrait-outline" size={20} color={colors.primaryText} />
            <AppText variant="bodySmall" style={styles.flex}>{t('triage.deviceMode')}</AppText>
          </Card>
        )}
        <FadeInView index={1}>
          <Card style={[styles.center, { gap: spacing.lg, paddingVertical: spacing.xxl }]}>
            <AppText color="textSecondary" align="center">{t('triage.activateBody')}</AppText>
            <HoldToConfirmButton label={t('triage.holdToActivate')} hint={t('triage.holdHint')} color={palette.red[600]} icon="medkit" duration={1200} onConfirm={() => activate(access.mode === 'device' ? 'deviceEmergency' : 'manual')} />
          </Card>
        </FadeInView>
        <FadeInView index={2} style={{ gap: spacing.sm }}>
          <AppText variant="label" color="textSecondary">{t('triage.simulateTitle')}</AppText>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <View style={styles.flex}>
              <Button label={t('triage.triggers.missedCheckIn')} variant="outline" size="sm" leftIcon="time-outline" fullWidth onPress={() => activate('missedCheckIn')} />
            </View>
            <View style={styles.flex}>
              <Button label={t('triage.triggers.crewEvent')} variant="outline" size="sm" leftIcon="warning-outline" fullWidth onPress={() => activate('crewEvent')} />
            </View>
          </View>
        </FadeInView>
        <ProtocolFooter />
      </Screen>
    );
  }

  const elapsed = now - new Date(active.startedAt).getTime();
  const assessed = rows.filter((r) => r.ev?.complete).length;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} onTouchStart={markActivity}>
      <Screen topInset={false}>
        <BackHeader title={t('triage.title')} subtitle={`${active.id} · ${formatDuration(elapsed)}`} />

        <Card style={{ gap: spacing.sm, backgroundColor: colors.status.critical.background, borderColor: colors.status.critical.ring }}>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Ionicons name="pulse" size={20} color={colors.status.critical.text} />
            <AppText variant="title" style={[styles.flex, { color: colors.status.critical.text }]}>{t('triage.activeTitle')}</AppText>
          </View>
          <AppText variant="bodySmall" style={{ color: colors.status.critical.text }}>
            {t('triage.activatedBy', { trigger: t(`triage.triggers.${active.trigger}`) })}
          </AppText>
          <AppText variant="caption" color="textSecondary">{t('triage.progress', { done: assessed, total: crew.length })}</AppText>
        </Card>

        <View style={{ gap: spacing.sm }}>
          <AppText variant="h3">{t('triage.priorityList')}</AppText>
          {rows.map(({ m, p, ev }, i) => {
            const c = ev?.category;
            const tc = c ? tone(c) : null;
            return (
              <FadeInView key={m.id} index={i}>
                <PressableScale
                  onPress={() => router.push({ pathname: '/triage/assess', params: { crewId: m.id } })}
                  accessibilityLabel={`${m.displayName}: ${c ? PROTOCOL.categories[c].label[lang] : t('triage.pending')}`}
                  style={[styles.row, { gap: spacing.md, padding: spacing.md, borderRadius: radius.button, backgroundColor: colors.surface, borderWidth: c === 'immediate' ? 2 : 1, borderColor: tc?.ring ?? colors.border }]}
                >
                  <AppText variant="h3" color="textMuted" style={{ width: 22 }}>{c ? i + 1 : '·'}</AppText>
                  <Avatar name={m.displayName} size={44} />
                  <View style={styles.flex}>
                    <AppText variant="title">{m.displayName}</AppText>
                    <AppText variant="caption" color="textSecondary">
                      {t(`crew.specialty.${m.specialty}`)} · {m.bloodType} · {t('crew.module', { module: m.module })}
                    </AppText>
                    {ev?.radiation && ev.radiation !== 'none' && (
                      <View style={[styles.row, { gap: 4 }]}>
                        <Ionicons name="nuclear" size={14} color={colors.accentText} />
                        <AppText variant="caption" color="accentText">{t(`triage.radiation.${ev.radiation}`)}</AppText>
                      </View>
                    )}
                    {p?.outOfProtocol && <AppText variant="caption" color="accentText">⚠ {t('triage.outOfProtocol')}</AppText>}
                  </View>
                  {c && tc ? (
                    <View style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: tc.bg, maxWidth: 120 }}>
                      <AppText variant="label" style={{ color: tc.fg, fontSize: 12 }} numberOfLines={2}>{PROTOCOL.categories[c].label[lang]}</AppText>
                    </View>
                  ) : (
                    <AppText variant="label" color="primaryText">{p ? t('triage.continue') : t('triage.assess')}</AppText>
                  )}
                </PressableScale>
              </FadeInView>
            );
          })}
        </View>

        <Card style={{ gap: spacing.md }}>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Ionicons name={linkDown ? 'cloud-offline-outline' : 'planet-outline'} size={20} color={linkDown ? colors.accentText : colors.primaryText} />
            <AppText variant="h3" style={styles.flex}>{t('triage.reportTitle')}</AppText>
          </View>
          <AppText variant="bodySmall" color="textSecondary">{linkDown ? t('triage.linkDown') : t('triage.linkUp', { delay: formatDuration(LINK_PROFILES[profile].oneWayDelaySec * 1000) })}</AppText>
          {reportMsg && (
            <AppText variant="bodySmall" color={reportStatus === 'delivered' ? 'primaryText' : 'accentText'}>
              {reportStatus === 'delivered'
                ? t('triage.reportDelivered')
                : reportStatus === 'queued'
                  ? t('triage.reportQueued')
                  : t('triage.reportInTransit', { eta: formatDuration((reportMsg.deliverAt ?? now) - now) })}
            </AppText>
          )}
          <Button
            label={reportMsg ? t('triage.resend') : t('triage.sendReport')}
            leftIcon="send"
            size="lg"
            fullWidth
            onPress={() => {
              sendTriageReport(crew);
              showToast({ level: 'info', title: t('triage.reportSentTitle'), body: t('triage.reportSentBody') });
            }}
          />
          <Button label={t('triage.seeComms')} variant="ghost" leftIcon="sync-outline" onPress={() => router.push('/comms')} />
        </Card>

        <View style={[styles.center, { gap: spacing.sm }]}>
          <HoldToConfirmButton
            label={t('triage.holdToClose')}
            hint={t('triage.closeHint')}
            color={palette.neutral[700]}
            icon="checkmark-done"
            size={156}
            duration={2500}
            onConfirm={() => {
              if (!active.reports.length) sendTriageReport(crew);
              close();
              showToast({ level: 'normal', title: t('triage.closedTitle'), body: t('triage.closedBody') });
              if (router.canGoBack()) router.back();
              else router.replace('/');
            }}
          />
          <AppText variant="caption" color="textMuted" align="center">{t('triage.closeHint')}</AppText>
        </View>
        <ProtocolFooter />
      </Screen>
    </SafeAreaView>
  );
}

function ProtocolFooter() {
  const { t, i18n } = useTranslation();
  const { spacing } = useAppTheme();
  const lang = i18n.language === 'es' ? 'es' : 'en';
  return (
    <View style={{ gap: spacing.xs }}>
      <AppText variant="caption" color="textMuted">{t('triage.protocolLine', { id: PROTOCOL.id, version: PROTOCOL.version, updated: PROTOCOL.updated })}</AppText>
      <AppText variant="caption" color="textMuted">{PROTOCOL.outOfProtocol[lang]}</AppText>
      {PROTOCOL.sources.map((s) => (
        <AppText key={s.id} variant="caption" color="textMuted">· {s.title}</AppText>
      ))}
      <Disclaimer />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
