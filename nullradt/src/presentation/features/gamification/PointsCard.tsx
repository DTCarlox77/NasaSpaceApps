import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppText, Card, ProgressBar } from '@/presentation/components/ui';
import { useGamification } from '@/presentation/hooks/useGamification';

/** Resumen de puntos, nivel y racha (abre Logros). */
export function PointsCard() {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const g = useGamification();
  const unlocked = g.badges.filter((b) => b.unlocked).length;
  return (
    <Card tone="night" onPress={() => router.push('/achievements')} accessibilityLabel={t('achievements.title')} style={{ gap: spacing.md }}>
      <View style={[styles.row, { gap: spacing.md }]}>
        <Ionicons name="trophy" size={26} color={colors.primary} />
        <View style={styles.flex}>
          <AppText variant="title" style={{ color: colors.onNight }}>
            {t('achievements.level', { level: g.level })} · {t('achievements.points', { count: g.points })}
          </AppText>
          <AppText variant="caption" style={{ color: colors.onNightMuted }}>
            {t('achievements.cardLine', { today: g.todayPoints, streak: g.streaks.checkIn, badges: unlocked, total: g.badges.length })}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.onNightMuted} />
      </View>
      <ProgressBar value={g.levelProgress / g.levelSize} color={colors.primary} onDark label={t('achievements.toNext', { count: g.levelSize - g.levelProgress })} />
    </Card>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center' }, flex: { flex: 1 } });
