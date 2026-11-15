import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeInRight } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { speak, stopSpeaking } from '@/core/speech/speech';
import { evaluateTriage, PROTOCOL, questionText } from '@/domain/triage/evaluator';
import { BackHeader } from '@/presentation/components/navigation/BackHeader';
import { AppText, Button, Card, IconButton, PressableScale, Screen, VoiceNoteInput } from '@/presentation/components/ui';
import { markActivity } from '@/presentation/features/triage/DeadManSwitch';
import { sendTriageReport } from '@/presentation/features/triage/triageReport';
import { useCrew } from '@/presentation/hooks/useCrew';
import { useVoiceDictation } from '@/presentation/hooks/useVoiceDictation';
import { showToast } from '@/presentation/store/toastStore';
import { useTriageStore } from '@/presentation/store/triageStore';

const YES = /\b(s[ií]|yes|yeah|afirmativo|correcto)\b/i;
const NO = /\b(no|negativo|nope)\b/i;

/** Evaluación de un tripulante, una pregunta a la vez (botones grandes + voz). */
export default function TriageAssessScreen() {
  const { t, i18n } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const { crewId } = useLocalSearchParams<{ crewId: string }>();
  const { crew } = useCrew();
  const member = crew.find((c) => c.id === crewId);
  const patient = useTriageStore((s) => (crewId ? s.active?.patients[crewId] : undefined));
  const hasIncident = useTriageStore((s) => !!s.active);
  const { answer, undo, resetPatient, setOutOfProtocol } = useTriageStore.getState();
  const lang = i18n.language === 'es' ? 'es' : 'en';
  const [voiceOn, setVoiceOn] = useState(true);
  const [note, setNote] = useState(patient?.outOfProtocol ?? '');

  const ev = useMemo(() => evaluateTriage(patient?.answers ?? {}), [patient?.answers]);
  const nextId = ev.next?.id;

  const respond = (value: boolean) => {
    if (!crewId || !nextId) return;
    markActivity();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    answer(crewId, nextId, value);
  };

  const dictation = useVoiceDictation(lang, {
    allowNetworkFallback: false,
    onFinal: (text) => {
      if (YES.test(text)) respond(true);
      else if (NO.test(text)) respond(false);
    },
  });

  // Lee cada pregunta en voz alta (y el resultado al terminar).
  useEffect(() => {
    if (!voiceOn) return;
    if (ev.next) speak(ev.next.node.q[lang], lang, { chime: false });
    else if (ev.category) speak(`${PROTOCOL.categories[ev.category].label[lang]}. ${PROTOCOL.actions[ev.category][lang][0]}`, lang, { chime: 'info' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextId, ev.category, voiceOn]);
  useEffect(() => stopSpeaking, []);

  useEffect(() => {
    if (ev.category === 'immediate') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  }, [ev.category]);

  if (!member || !hasIncident) {
    return (
      <Screen>
        <BackHeader title={t('triage.title')} fallback="/triage" />
        <AppText color="textSecondary">{t('triage.noIncident')}</AppText>
      </Screen>
    );
  }

  const lastAnswered = ev.path.filter((s) => !s.auto).pop();
  const cat = ev.category;
  const catTone = cat ? PROTOCOL.categories[cat].tone : null;
  const catColors =
    catTone === 'black'
      ? { bg: colors.night, fg: colors.onNight }
      : catTone
        ? { bg: colors.status[catTone as 'critical'].background, fg: colors.status[catTone as 'critical'].text }
        : null;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} onTouchStart={markActivity}>
      <Screen topInset={false}>
        <BackHeader
          title={member.displayName}
          subtitle={`${t(`crew.specialty.${member.specialty}`)} · ${member.bloodType}`}
          fallback="/triage"
          right={
            <IconButton
              icon={voiceOn ? 'volume-high' : 'volume-mute-outline'}
              tone="filled"
              accessibilityLabel={t('triage.voiceToggle')}
              onPress={() => {
                if (voiceOn) stopSpeaking();
                setVoiceOn(!voiceOn);
              }}
            />
          }
        />

        {!ev.responsive && (
          <Card tone="alt" style={[styles.row, { gap: spacing.sm }]}>
            <Ionicons name="eye-outline" size={18} color={colors.accentText} />
            <AppText variant="bodySmall" color="accentText" style={styles.flex}>{t('triage.observableOnly')}</AppText>
          </Card>
        )}

        {ev.next ? (
          <Animated.View key={ev.next.id} entering={FadeInRight.duration(220)} style={{ gap: spacing.lg }}>
            <Card style={{ gap: spacing.md, paddingVertical: spacing.xxl }}>
              <View style={[styles.row, { gap: spacing.sm }]}>
                <View style={{ paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: ev.next.module === 'radiation' ? colors.status.caution.background : colors.surfaceAlt }}>
                  <AppText variant="caption" color={ev.next.module === 'radiation' ? 'accentText' : 'textSecondary'}>
                    {ev.next.module === 'radiation' ? t('triage.radiationModule') : t('triage.step', { n: ev.path.length + 1 })}
                  </AppText>
                </View>
                {ev.next.node.observable && (
                  <View style={[styles.row, { gap: 4 }]}>
                    <Ionicons name="eye-outline" size={14} color={colors.textMuted} />
                    <AppText variant="caption" color="textMuted">{t('triage.observable')}</AppText>
                  </View>
                )}
              </View>
              <AppText variant="h2" accessibilityLiveRegion="assertive">{ev.next.node.q[lang]}</AppText>
            </Card>
            <View style={[styles.row, { gap: spacing.md }]}>
              <PressableScale onPress={() => respond(true)} accessibilityRole="button" accessibilityLabel={t('triage.yes')} style={[styles.answer, { backgroundColor: colors.primary, borderRadius: radius.xl }]}>
                <Ionicons name="checkmark" size={40} color={colors.onPrimary} />
                <AppText variant="h1" style={{ color: colors.onPrimary }}>{t('triage.yes')}</AppText>
              </PressableScale>
              <PressableScale onPress={() => respond(false)} accessibilityRole="button" accessibilityLabel={t('triage.no')} style={[styles.answer, { backgroundColor: colors.night, borderRadius: radius.xl }]}>
                <Ionicons name="close" size={40} color={colors.onNight} />
                <AppText variant="h1" style={{ color: colors.onNight }}>{t('triage.no')}</AppText>
              </PressableScale>
            </View>
            {dictation.supported && (
              <Button
                label={dictation.listening ? t('triage.listening') : t('triage.answerByVoice')}
                leftIcon={dictation.listening ? 'mic' : 'mic-outline'}
                variant="outline"
                fullWidth
                onPress={dictation.listening ? dictation.stop : dictation.start}
              />
            )}
          </Animated.View>
        ) : cat && catColors ? (
          <Animated.View entering={FadeInRight.duration(220)} style={{ gap: spacing.md }}>
            <Card style={{ gap: spacing.md, backgroundColor: catColors.bg, borderColor: catColors.bg, paddingVertical: spacing.xxl }}>
              <AppText variant="caption" style={{ color: catColors.fg }}>{t('triage.result')}</AppText>
              <AppText variant="h1" style={{ color: catColors.fg }}>{PROTOCOL.categories[cat].label[lang]}</AppText>
              {ev.baseCategory !== cat && <AppText variant="bodySmall" style={{ color: catColors.fg }}>{t('triage.upgradedByRadiation')}</AppText>}
            </Card>
            <Card style={{ gap: spacing.sm }}>
              <AppText variant="h3">{t('triage.whatNow')}</AppText>
              {[...PROTOCOL.actions[cat][lang], ...(ev.radiation === 'high' ? PROTOCOL.actions.radiationHigh[lang] : [])].map((a, i) => (
                <View key={a} style={[styles.row, { gap: spacing.md, alignItems: 'flex-start' }]}>
                  <View style={[styles.num, { backgroundColor: colors.primarySoft }]}>
                    <AppText variant="label" color="primaryText">{i + 1}</AppText>
                  </View>
                  <AppText style={styles.flex}>{a}</AppText>
                </View>
              ))}
            </Card>
            <Button label={t('triage.backToBoard')} leftIcon="list" size="lg" fullWidth onPress={() => router.back()} />
            <Button label={t('triage.reassess')} variant="outline" leftIcon="refresh" fullWidth onPress={() => crewId && resetPatient(crewId)} />
          </Animated.View>
        ) : null}

        {lastAnswered && (
          <Button label={t('triage.undo')} variant="ghost" leftIcon="arrow-undo" onPress={() => crewId && undo(crewId, lastAnswered.id)} />
        )}

        {ev.path.length > 0 && (
          <Card tone="alt" style={{ gap: spacing.xs }}>
            <AppText variant="label" color="textSecondary">{t('triage.pathTitle')}</AppText>
            {ev.path.map((s) => (
              <AppText key={s.id} variant="caption" color="textSecondary">
                {questionText(s.id, lang)} → <AppText variant="caption" style={{ fontWeight: '700' }}>{s.answer ? t('triage.yes') : t('triage.no')}</AppText>
                {s.auto ? ` (${t('triage.auto')})` : ''}
              </AppText>
            ))}
          </Card>
        )}

        <Card style={{ gap: spacing.sm }}>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.accentText} />
            <AppText variant="h3" style={styles.flex}>{t('triage.outOfProtocol')}</AppText>
          </View>
          <AppText variant="caption" color="textSecondary">{PROTOCOL.outOfProtocol[lang]}</AppText>
          <VoiceNoteInput value={note} onChangeText={setNote} placeholder={t('triage.outOfProtocolPlaceholder')} />
          <Button
            label={t('triage.sendToEarth')}
            variant="secondary"
            leftIcon="send"
            disabled={!note.trim()}
            onPress={() => {
              if (!crewId) return;
              setOutOfProtocol(crewId, note.trim());
              setTimeout(() => sendTriageReport(crew), 0);
              showToast({ level: 'info', title: t('triage.reportSentTitle'), body: t('triage.reportSentBody') });
            }}
          />
        </Card>
      </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  answer: { flex: 1, minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 4 },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
});
