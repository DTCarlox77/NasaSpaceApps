import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import i18n from '@/core/i18n';
import { useAppTheme } from '@/core/theme';
import { GAD2_ITEMS, PHQ2_ITEMS, scoreScreening, screeningSchedule } from '@/domain/wellbeing/screening';
import { BackHeader } from '@/presentation/components/navigation/BackHeader';
import { AppText, Button, Card, FadeInView, PressableScale, Screen } from '@/presentation/components/ui';
import { useMissionStatus } from '@/presentation/hooks/useMissionStatus';
import { useAuthStore } from '@/presentation/store/authStore';
import { sendToEarth } from '@/presentation/store/outboxStore';
import { useWellbeingStore, type Screening } from '@/presentation/store/wellbeingStore';

const ITEMS = [...PHQ2_ITEMS, ...GAD2_ITEMS];
const OPTIONS = [0, 1, 2, 3] as const;

/** PHQ-2 + GAD-2 quincenal (uso libre). Positivo → escalamiento CONFIDENCIAL a salud conductual. */
export default function ScreeningScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const session = useAuthStore((s) => s.session);
  const userId = session?.userId ?? '';
  const screenings = useWellbeingStore((s) => s.screenings[userId]);
  const addScreening = useWellbeingStore((s) => s.addScreening);
  const mission = useMissionStatus();
  const missionDay = mission?.missionDay ?? 1;
  const schedule = screeningSchedule(missionDay, screenings?.[screenings.length - 1]?.missionDay);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [early, setEarly] = useState(false);
  const [result, setResult] = useState<Screening | null>(null);
  const ready = ITEMS.every((i) => answers[i] !== undefined);
  const canAnswer = schedule.open || early;

  const submit = () => {
    const phq: [number, number] = [answers.phq1!, answers.phq2!];
    const gad: [number, number] = [answers.gad1!, answers.gad2!];
    const score = scoreScreening(phq, gad);
    const saved = addScreening(userId, { phq, gad, ...score, missionDay });
    // Detalle → solo salud conductual (confidencial). Control de misión → solo cumplimiento.
    sendToEarth({
      kind: 'screening',
      audience: 'behavioralHealth',
      fromId: userId,
      subjectId: userId,
      confidential: true,
      title: i18n.t(score.positive ? 'wellbeingPlus.screening.bhTitlePositive' : 'wellbeingPlus.screening.bhTitle', { name: session?.displayName ?? userId }),
      body: i18n.t('wellbeingPlus.screening.bhBody', { phq: score.phqTotal, gad: score.gadTotal, day: missionDay }),
    });
    sendToEarth({
      kind: 'screening',
      audience: 'missionControl',
      fromId: userId,
      subjectId: userId,
      confidential: false,
      title: i18n.t('wellbeingPlus.screening.complianceTitle'),
      body: i18n.t('wellbeingPlus.screening.complianceBody', { name: session?.displayName ?? userId }),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setResult(saved);
  };

  return (
    <Screen>
      <BackHeader title={t('wellbeingPlus.screening.title')} subtitle={t('wellbeingPlus.screening.subtitle')} fallback="/wellbeing" />

      {result ? (
        <Animated.View entering={FadeIn} style={{ gap: spacing.lg }}>
          <Card style={[styles.center, { gap: spacing.md, paddingVertical: spacing.xxl }]}>
            <Ionicons name={result.positive ? 'chatbubbles' : 'checkmark-circle'} size={56} color={colors.primaryText} />
            <AppText variant="h2" align="center">{t('wellbeingPlus.screening.thanks')}</AppText>
            <AppText color="textSecondary" align="center">{result.positive ? t('wellbeingPlus.screening.positiveBody') : t('wellbeingPlus.screening.negativeBody')}</AppText>
          </Card>
          {result.positive && <Button label={t('wellbeingPlus.talk.cta')} leftIcon="chatbubbles-outline" size="lg" fullWidth onPress={() => router.replace('/wellbeing/talk')} />}
          <Button label={t('tests.done')} variant="outline" fullWidth onPress={() => router.back()} />
        </Animated.View>
      ) : !canAnswer ? (
        <Card style={{ gap: spacing.md }}>
          <AppText variant="h3">{schedule.doneThisCycle ? t('wellbeingPlus.screening.doneTitle') : t('wellbeingPlus.screening.notYetTitle')}</AppText>
          <AppText color="textSecondary">
            {schedule.doneThisCycle ? t('wellbeingPlus.screening.done', { day: schedule.conference }) : t('wellbeingPlus.screening.next', { count: schedule.daysUntilOpen, day: schedule.conference })}
          </AppText>
          <Button label={t('wellbeingPlus.screening.early')} variant="ghost" leftIcon="flask-outline" onPress={() => setEarly(true)} />
        </Card>
      ) : (
        <>
          <Card tone="alt" style={{ gap: spacing.xs }}>
            <AppText variant="label">{t('wellbeingPlus.screening.prompt')}</AppText>
            <AppText variant="caption" color="textSecondary">{t('wellbeingPlus.screening.private')}</AppText>
          </Card>
          {ITEMS.map((item, i) => (
            <FadeInView key={item} index={i}>
              <Card style={{ gap: spacing.md }}>
                <AppText variant="title">{t(`wellbeingPlus.screening.items.${item}`)}</AppText>
                <View style={{ gap: spacing.sm }}>
                  {OPTIONS.map((o) => {
                    const on = answers[item] === o;
                    return (
                      <PressableScale
                        key={o}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        onPress={() => {
                          Haptics.selectionAsync().catch(() => {});
                          setAnswers((a) => ({ ...a, [item]: o }));
                        }}
                        style={[styles.row, { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? colors.tertiary : colors.border, backgroundColor: on ? colors.surfaceSage : colors.surface }]}
                      >
                        <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.tertiary : colors.textMuted} />
                        <AppText style={styles.flex}>{t(`wellbeingPlus.screening.options.${o}`)}</AppText>
                      </PressableScale>
                    );
                  })}
                </View>
              </Card>
            </FadeInView>
          ))}
          <Button label={t('wellbeingPlus.screening.submit')} leftIcon="lock-closed" size="lg" fullWidth disabled={!ready} onPress={submit} />
          <AppText variant="caption" color="textMuted">{t('wellbeingPlus.screening.source')}</AppText>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
