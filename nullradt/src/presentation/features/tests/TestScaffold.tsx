import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { Sparkline } from '@/presentation/components/health/Sparkline';
import { AppText, Button, Card, IconButton } from '@/presentation/components/ui';
import { useAuthStore } from '@/presentation/store/authStore';
import { todayKey, useRoutineStore } from '@/presentation/store/routineStore';
import { LOWER_IS_BETTER, personalBest, resultsOf, TEST_IDS, useTestsStore, type TestId, type TestResult } from '@/presentation/store/testsStore';

export const TEST_ICONS: Record<TestId, keyof typeof Ionicons.glyphMap> = {
  reaction: 'flash-outline',
  vision: 'eye-outline',
  stroop: 'color-palette-outline',
  memory: 'grid-outline',
};

type Phase = 'intro' | 'running' | 'result';

export interface TestRunProps {
  onComplete: (r: Pick<TestResult, 'score' | 'details'>) => void;
}

/**
 * Armazón común de los tests: introducción → prueba → resultado (con marca personal e historial).
 * `format` convierte el puntaje en texto; `extra` muestra detalles bajo el resultado.
 */
export function TestScaffold({
  id,
  Run,
  format,
  extra,
  onSaved,
  introExtra,
}: {
  introExtra?: ReactNode;
  id: TestId;
  Run: (p: TestRunProps) => ReactNode;
  format: (score: number) => string;
  extra?: (r: TestResult) => ReactNode;
  onSaved?: (r: TestResult) => void;
}) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const userId = useAuthStore((s) => s.session?.userId ?? '');
  const all = useTestsStore((s) => s.results[userId]);
  const add = useTestsStore((s) => s.add);
  const [phase, setPhase] = useState<Phase>('intro');
  const [result, setResult] = useState<TestResult | null>(null);
  const [runKey, setRunKey] = useState(0);

  const history = resultsOf(all, id);
  const best = result ? personalBest(history, result) : personalBest(history);
  const improved = result && best !== null && (LOWER_IS_BETTER[id] ? result.score < best : result.score > best);

  const complete: TestRunProps['onComplete'] = (r) => {
    const saved = add(userId, { testId: id, ...r });
    setResult(saved);
    setPhase('result');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onSaved?.(saved);
    // Si ya hizo los 4 tests hoy, se marca en la rutina.
    const mine = useTestsStore.getState().results[userId];
    const routine = useRoutineStore.getState();
    if (TEST_IDS.every((tid) => resultsOf(mine, tid).some((x) => x.day === todayKey())) && !(routine.done[todayKey()] ?? []).includes('brainTests')) {
      routine.toggleDone('brainTests');
    }
  };
  const start = () => {
    setResult(null);
    setRunKey((k) => k + 1);
    setPhase('running');
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={[styles.row, { gap: spacing.md, padding: spacing.lg }]}>
        <IconButton icon="arrow-back" tone="filled" accessibilityLabel={t('common.back')} onPress={() => (phase === 'running' ? setPhase('intro') : router.back())} />
        <View style={styles.flex}>
          <AppText variant="h2">{t(`tests.items.${id}.title`)}</AppText>
          <AppText variant="caption" color="textMuted">{t(`tests.items.${id}.tagline`)}</AppText>
        </View>
      </View>

      {phase === 'running' ? (
        <View style={[styles.flex, { padding: spacing.lg, paddingTop: 0 }]}>
          <Run key={runKey} onComplete={complete} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, gap: spacing.lg }}>
          {phase === 'intro' && (
            <Animated.View entering={FadeIn.duration(200)} style={{ gap: spacing.lg }}>
              <Card style={[styles.center, { gap: spacing.md, paddingVertical: spacing.xxl }]}>
                <View style={[styles.bigIcon, { backgroundColor: colors.primarySoft }]}>
                  <Ionicons name={TEST_ICONS[id]} size={44} color={colors.primaryText} />
                </View>
                <AppText align="center" color="textSecondary">{t(`tests.items.${id}.why`)}</AppText>
              </Card>
              <Card style={{ gap: spacing.sm }}>
                <AppText variant="title">{t('tests.how')}</AppText>
                {(t(`tests.items.${id}.steps`, { returnObjects: true }) as string[]).map((step, i) => (
                  <View key={step} style={[styles.row, { gap: spacing.sm, alignItems: 'flex-start' }]}>
                    <View style={[styles.stepNum, { backgroundColor: colors.night, borderRadius: radius.pill }]}>
                      <AppText variant="caption" style={{ color: colors.onNight }}>{i + 1}</AppText>
                    </View>
                    <AppText style={styles.flex}>{step}</AppText>
                  </View>
                ))}
              </Card>
              {introExtra}
              <Button label={t('tests.start')} leftIcon="play" size="lg" fullWidth onPress={start} />
            </Animated.View>
          )}

          {phase === 'result' && result && (
            <Animated.View entering={FadeIn.duration(250)} style={{ gap: spacing.lg }}>
              <Card tone="night" style={[styles.center, { gap: spacing.sm, paddingVertical: spacing.xxl }]}>
                {improved && (
                  <View style={[styles.row, { gap: 6, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.primary }]}>
                    <Ionicons name="trophy" size={14} color="#13201A" />
                    <AppText variant="label" style={{ color: '#13201A' }}>{t('tests.newBest')}</AppText>
                  </View>
                )}
                <AppText variant="display" style={{ color: colors.onNight, fontSize: 52, lineHeight: 60, fontVariant: ['tabular-nums'] }}>{format(result.score)}</AppText>
                <AppText style={{ color: colors.onNightMuted }}>{t(`tests.items.${id}.scoreLabel`)}</AppText>
                {best !== null && <AppText variant="caption" style={{ color: colors.onNightMuted }}>{t('tests.best', { value: format(best) })}</AppText>}
              </Card>
              {extra?.(result)}
              {history.length > 1 && (
                <Card style={{ gap: spacing.sm }}>
                  <AppText variant="title">{t('tests.trend')}</AppText>
                  <Sparkline data={history.slice(-14).map((r) => r.score)} width={300} height={60} />
                  <AppText variant="caption" color="textMuted">{LOWER_IS_BETTER[id] ? t('tests.lowerBetter') : t('tests.higherBetter')}</AppText>
                </Card>
              )}
              <Button label={t('tests.again')} leftIcon="refresh" variant="outline" fullWidth onPress={start} />
              <Button label={t('tests.done')} leftIcon="checkmark" size="lg" fullWidth onPress={() => router.back()} />
              <AppText variant="caption" color="textMuted">{t('tests.disclaimer')}</AppText>
            </Animated.View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  bigIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  stepNum: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
});
