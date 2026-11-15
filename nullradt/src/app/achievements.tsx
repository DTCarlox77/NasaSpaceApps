import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { POINTS, type Badge, type StreakId } from '@/domain/gamification/achievements';
import { BackHeader } from '@/presentation/components/navigation/BackHeader';
import { AppText, Card, FadeInView, ProgressBar, Screen } from '@/presentation/components/ui';
import { useGamification } from '@/presentation/hooks/useGamification';

const STREAK_ICON: Record<StreakId, keyof typeof Ionicons.glyphMap> = {
  checkIn: 'heart',
  measurement: 'pulse',
  exercise: 'barbell',
  sleep: 'moon',
};

/** Logros: puntos, nivel, rachas por hábito e insignias. Se premia completar, nunca el resultado. */
export default function AchievementsScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const g = useGamification();

  return (
    <Screen>
      <BackHeader title={t('achievements.title')} subtitle={t('achievements.subtitle')} />

      <FadeInView index={1}>
        <Card tone="night" style={{ gap: spacing.md }}>
          <AppText variant="label" style={{ color: colors.onNightMuted }}>{t('achievements.level', { level: g.level })}</AppText>
          <View style={[styles.row, { gap: spacing.sm, alignItems: 'baseline' }]}>
            <AppText variant="metric" style={{ color: colors.primary }}>{g.points}</AppText>
            <AppText style={{ color: colors.onNightMuted }}>{t('achievements.pointsLabel')}</AppText>
          </View>
          <ProgressBar value={g.levelProgress / g.levelSize} color={colors.primary} onDark label={t('achievements.toNext', { count: g.levelSize - g.levelProgress })} />
          <AppText variant="caption" style={{ color: colors.onNightMuted }}>{t('achievements.today', { count: g.todayPoints })}</AppText>
        </Card>
      </FadeInView>

      <FadeInView index={2} style={{ gap: spacing.sm }}>
        <AppText variant="h3">{t('achievements.streaks')}</AppText>
        <View style={[styles.wrap, { gap: spacing.sm }]}>
          {(Object.keys(STREAK_ICON) as StreakId[]).map((k) => (
            <Card key={k} tone="alt" style={[styles.half, { gap: spacing.xs, padding: spacing.lg }]}>
              <Ionicons name={STREAK_ICON[k]} size={22} color={g.streaks[k] > 0 ? colors.accent : colors.textMuted} />
              <AppText variant="h2">{t('achievements.days', { count: g.streaks[k] })}</AppText>
              <AppText variant="caption" color="textSecondary">{t(`achievements.streak.${k}`)}</AppText>
            </Card>
          ))}
        </View>
      </FadeInView>

      <FadeInView index={3} style={{ gap: spacing.sm }}>
        <AppText variant="h3">{t('achievements.badges')}</AppText>
        <View style={[styles.wrap, { gap: spacing.sm }]}>
          {g.badges.map((b, i) => (
            <BadgeTile key={b.id} badge={b} index={i} />
          ))}
        </View>
      </FadeInView>

      <FadeInView index={4}>
        <Card style={{ gap: spacing.sm }}>
          <AppText variant="h3">{t('achievements.howTitle')}</AppText>
          {(Object.keys(POINTS) as (keyof typeof POINTS)[]).map((k) => (
            <View key={k} style={[styles.row, { gap: spacing.sm }]}>
              <AppText style={styles.flex}>{t(`achievements.how.${k}`)}</AppText>
              <View style={{ paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.primarySoft }}>
                <AppText variant="label" color="primaryText">+{POINTS[k]}</AppText>
              </View>
            </View>
          ))}
          <AppText variant="caption" color="textMuted">{t('achievements.fairPlay')}</AppText>
        </Card>
      </FadeInView>
    </Screen>
  );
}

function BadgeTile({ badge, index }: { badge: Badge; index: number }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const scale = useSharedValue(0.6);
  useEffect(() => {
    scale.value = withDelay(index * 60, withSpring(1, { damping: 14, stiffness: 160 }));
  }, [index, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View
      style={[
        styles.half,
        style,
        {
          padding: spacing.lg,
          gap: spacing.xs,
          borderRadius: radius.button,
          borderWidth: 1,
          backgroundColor: badge.unlocked ? colors.surfaceTinted : colors.surfaceAlt,
          borderColor: badge.unlocked ? colors.status.normal.ring : colors.border,
        },
      ]}
      accessible
      accessibilityLabel={`${t(`achievements.badge.${badge.id}.title`)}: ${badge.unlocked ? t('achievements.unlocked') : `${badge.current}/${badge.target}`}`}
    >
      <View style={[styles.badgeIcon, { backgroundColor: badge.unlocked ? colors.primary : colors.progressTrack }]}>
        <Ionicons name={(badge.unlocked ? badge.icon : 'lock-closed') as keyof typeof Ionicons.glyphMap} size={22} color={badge.unlocked ? colors.onPrimary : colors.textMuted} />
      </View>
      <AppText variant="title" numberOfLines={2}>{t(`achievements.badge.${badge.id}.title`)}</AppText>
      <AppText variant="caption" color="textSecondary" numberOfLines={2}>{t(`achievements.badge.${badge.id}.body`)}</AppText>
      {!badge.unlocked && <ProgressBar value={badge.current / badge.target} color={colors.tertiary} label={`${badge.current}/${badge.target}`} />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  half: { flexBasis: '47%', flexGrow: 1 },
  badgeIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
