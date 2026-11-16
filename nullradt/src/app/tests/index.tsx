import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { Sparkline } from '@/presentation/components/health/Sparkline';
import { AppText, Card, FadeInView, IconButton, ProgressBar, Screen } from '@/presentation/components/ui';
import { TEST_ICONS } from '@/presentation/features/tests/TestScaffold';
import { useAuthStore } from '@/presentation/store/authStore';
import { todayKey } from '@/presentation/store/routineStore';
import { personalBest, resultsOf, TEST_IDS, testStreak, useTestsStore, type TestId } from '@/presentation/store/testsStore';

const FORMAT: Record<TestId, (s: number) => string> = {
  reaction: (s) => `${s} ms`,
  vision: (s) => `${s}/10`,
  stroop: (s) => `${s}/min`,
  memory: (s) => String(s),
};

/** Entrenamiento diario: reflejos, claridad visual y agilidad mental. */
export default function TestsHub() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const userId = useAuthStore((s) => s.session?.userId ?? '');
  const all = useTestsStore((s) => s.results[userId]);
  const today = todayKey();
  const doneToday = TEST_IDS.filter((id) => resultsOf(all, id).some((r) => r.day === today));

  return (
    <Screen>
      <FadeInView style={[styles.row, { gap: spacing.md }]}>
        <IconButton icon="arrow-back" tone="filled" accessibilityLabel={t('common.back')} onPress={() => router.back()} />
        <View style={styles.flex}>
          <AppText variant="h1">{t('tests.title')}</AppText>
          <AppText variant="caption" color="textMuted">{t('tests.subtitle')}</AppText>
        </View>
      </FadeInView>

      <FadeInView index={1}>
        <Card tone="night" style={{ gap: spacing.md }}>
          <View style={[styles.row, { gap: spacing.lg }]}>
            <View style={styles.flex}>
              <AppText variant="h2" style={{ color: colors.primary }}>{doneToday.length}/{TEST_IDS.length}</AppText>
              <AppText variant="caption" style={{ color: colors.onNightMuted }}>{t('tests.today')}</AppText>
            </View>
            <View style={styles.flex}>
              <AppText variant="h2" style={{ color: colors.primary }}>{testStreak(all)}</AppText>
              <AppText variant="caption" style={{ color: colors.onNightMuted }}>{t('tests.streak')}</AppText>
            </View>
          </View>
          <ProgressBar value={doneToday.length / TEST_IDS.length} color={colors.primary} onDark />
          <AppText variant="bodySmall" style={{ color: colors.onNightMuted }}>
            {doneToday.length === TEST_IDS.length ? t('tests.allDone') : t('tests.keepGoing')}
          </AppText>
        </Card>
      </FadeInView>

      {TEST_IDS.map((id, i) => {
        const list = resultsOf(all, id);
        const last = list[list.length - 1];
        const best = personalBest(list);
        const done = doneToday.includes(id);
        return (
          <FadeInView key={id} index={2 + i}>
            <Card
              onPress={() => router.push(`/tests/${id}` as Href)}
              accessibilityLabel={t(`tests.items.${id}.title`)}
              style={{ gap: spacing.md, borderWidth: 1, borderColor: done ? colors.status.normal.ring : colors.border }}
            >
              <View style={[styles.row, { gap: spacing.md }]}>
                <View style={[styles.icon, { borderRadius: radius.md, backgroundColor: done ? colors.primary : colors.surfaceTinted }]}>
                  <Ionicons name={done ? 'checkmark' : TEST_ICONS[id]} size={24} color={done ? colors.onPrimary : colors.primaryText} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="title">{t(`tests.items.${id}.title`)}</AppText>
                  <AppText variant="caption" color="textSecondary">{t(`tests.items.${id}.tagline`)} · {t('tests.duration', { min: DURATION[id] })}</AppText>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </View>
              {last && (
                <View style={[styles.row, { gap: spacing.md }]}>
                  <View style={styles.flex}>
                    <AppText variant="label">{t('tests.last', { value: FORMAT[id](last.score) })}</AppText>
                    {best !== null && <AppText variant="caption" color="textMuted">{t('tests.best', { value: FORMAT[id](best) })}</AppText>}
                  </View>
                  <Sparkline data={list.slice(-10).map((r) => r.score)} />
                </View>
              )}
            </Card>
          </FadeInView>
        );
      })}
      <AppText variant="caption" color="textMuted">{t('tests.disclaimer')}</AppText>
    </Screen>
  );
}

const DURATION: Record<TestId, number> = { reaction: 1, vision: 2, stroop: 1, memory: 2 };

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
