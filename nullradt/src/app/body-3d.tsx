import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { BODY_SYSTEM_IDS } from '@/domain/entities/BodySystem';
import type { BodySystemId, HealthStatus } from '@/domain/entities/HealthIndicator';
import { ErrorFallbackView, SectionErrorBoundary } from '@/presentation/components/feedback/ErrorFallback';
import { Body3D } from '@/presentation/components/health/Body3D';
import { AppText, Card, FadeInView, IconButton, PressableScale, StatusBadge } from '@/presentation/components/ui';
import { IndicatorRow, StatusLegend, SystemIcon } from '@/presentation/features/health/healthUi';
import { useHealthOverview } from '@/presentation/hooks/useHealthOverview';
import { useCrew } from '@/presentation/hooks/useCrew';
import { useAuthStore } from '@/presentation/store/authStore';
import { useUiStore } from '@/presentation/store/uiStore';

/** Vista 3D del cuerpo: ver mejor dónde están los síntomas por sistema. */
export default function Body3DScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius, isDark } = useAppTheme();
  const { overview } = useHealthOverview();
  const { selectedSystem, setSelectedSystem } = useUiStore();
  // El modelo 3D corresponde al sexo del tripulante de la sesión.
  const { me } = useCrew();
  // Con API: `context.sex` del login (solo lo recibe el propio astronauta).
  const sessionSex = useAuthStore((s) => s.session?.sex);
  const bodyModel = me?.sex ?? sessionSex ?? 'male';

  const statuses = useMemo(
    () => Object.fromEntries((overview?.systems ?? []).map((s) => [s.id, s.status])) as Record<BodySystemId, HealthStatus>,
    [overview],
  );
  const system = overview?.systems.find((s) => s.id === selectedSystem);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.flex, { backgroundColor: colors.night }]}>
      <StatusBar style="light" />
      <View style={[styles.row, { gap: spacing.md, padding: spacing.lg }]}>
        <IconButton icon="arrow-back" tone="onHero" accessibilityLabel={t('common.back')} onPress={() => router.back()} />
        <View style={styles.flex}>
          <AppText variant="h2" style={{ color: colors.onNight }}>{t('body3d.title')}</AppText>
          <AppText variant="caption" style={{ color: colors.onNightMuted }}>{t('body3d.hint')}</AppText>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.huge }} showsVerticalScrollIndicator={false}>
        <SectionErrorBoundary onBack={() => router.back()}>
          <Body3D model={bodyModel} statuses={statuses} selected={selectedSystem} onSelect={setSelectedSystem} dark={isDark} height={460} />
        </SectionErrorBoundary>

        <View style={[styles.sheet, { backgroundColor: colors.background, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: spacing.lg, gap: spacing.lg }]}>
          <StatusLegend />
          <View accessibilityRole="radiogroup" style={[styles.wrap, { gap: spacing.sm }]}>
            {BODY_SYSTEM_IDS.map((id) => {
              const active = id === selectedSystem;
              const c = colors.status[statuses[id] ?? 'unevaluated'];
              return (
                <PressableScale
                  key={id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  onPress={() => setSelectedSystem(id)}
                  style={[
                    styles.row,
                    {
                      gap: 6,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.sm,
                      borderRadius: radius.pill,
                      backgroundColor: active ? colors.night : colors.surfaceAlt,
                      borderWidth: 1,
                      borderColor: active ? colors.night : colors.border,
                    },
                  ]}
                >
                  <View style={[styles.dot, { backgroundColor: c.solid }]} />
                  <AppText variant="label" style={{ color: active ? colors.onNight : colors.text }}>{t(`systems.${id}.short`)}</AppText>
                </PressableScale>
              );
            })}
          </View>

          {system && (
            <FadeInView key={system.id}>
              <Card style={{ gap: spacing.md }}>
                <View style={[styles.row, { gap: spacing.md }]}>
                  <View style={[styles.iconTile, { backgroundColor: colors.surfaceTinted, borderRadius: radius.md }]}>
                    <SystemIcon id={system.id} color={colors.primaryText} />
                  </View>
                  <View style={[styles.flex, { gap: 4 }]}>
                    <AppText variant="title">{t(`systems.${system.id}.name`)}</AppText>
                    <StatusBadge status={system.status} size="sm" />
                  </View>
                </View>
                <View style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.status[system.status].background }}>
                  <AppText variant="bodySmall" style={{ color: colors.status[system.status].text }}>{t(`body.callout.${system.status}`)}</AppText>
                </View>
                {system.indicators.map((ind) => (
                  <IndicatorRow
                    key={ind.id}
                    indicator={ind}
                    onPress={() => {
                      router.back();
                      router.navigate('/body');
                    }}
                  />
                ))}
                <View style={{ gap: spacing.xs }}>
                  {(t(`systems.${system.id}.recommendations`, { returnObjects: true }) as string[]).map((rec) => (
                    <View key={rec} style={[styles.row, { gap: spacing.sm, alignItems: 'flex-start' }]}>
                      <Ionicons name="bulb-outline" size={16} color={colors.primaryText} style={{ marginTop: 3 }} />
                      <AppText variant="bodySmall" style={styles.flex}>{rec}</AppText>
                    </View>
                  ))}
                </View>
              </Card>
            </FadeInView>
          )}
          <AppText variant="caption" color="textMuted">{t('body3d.disclaimer')}</AppText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  sheet: { marginTop: -8, minHeight: 300 },
  iconTile: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});

/** Si la pantalla completa falla, Expo Router muestra esto en lugar de cerrar la app. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaView style={styles.flex}>
      <ErrorFallbackView error={error} onRetry={retry} onBack={() => router.back()} />
    </SafeAreaView>
  );
}
