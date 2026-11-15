import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { BODY_SYSTEM_IDS } from '@/domain/entities/BodySystem';
import type { BodySystemId, HealthIndicator, HealthStatus } from '@/domain/entities/HealthIndicator';
import { BodyFigure } from '@/presentation/components/health/BodyFigure';
import { Sparkline } from '@/presentation/components/health/Sparkline';
import { AppText, Button, Card, FadeInView, PressableScale, Screen, StatusBadge } from '@/presentation/components/ui';
import { formatValue, StatusLegend, SystemIcon, timeAgo } from '@/presentation/features/health/healthUi';
import { useHealthOverview } from '@/presentation/hooks/useHealthOverview';
import { isMeasurable } from '@/domain/usecases/SimulateMeasurement';
import { showToast } from '@/presentation/store/toastStore';
import { useUiStore } from '@/presentation/store/uiStore';

/** Monitor (Figma "Health monitoring"): mapa corporal + detalle del sistema elegido. */
export default function MonitorScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const { overview } = useHealthOverview();
  const { selectedSystem, setSelectedSystem } = useUiStore();

  const statuses = useMemo(
    () => Object.fromEntries((overview?.systems ?? []).map((s) => [s.id, s.status])) as Record<BodySystemId, HealthStatus>,
    [overview],
  );
  const system = overview?.systems.find((s) => s.id === selectedSystem);
  const comingSoon = (title: string) => showToast({ level: 'info', title, body: t('common.comingSoon') });

  return (
    <Screen topInset={false}>
      <FadeInView style={{ gap: spacing.xs }}>
        <AppText variant="h1">{t('body.title')}</AppText>
        <AppText color="textSecondary">{t('body.subtitle')}</AppText>
      </FadeInView>

      <FadeInView index={1}>
        <Card style={{ gap: spacing.lg }}>
          <StatusLegend />
          <BodyFigure statuses={statuses} selected={selectedSystem} onSelect={setSelectedSystem} height={460} />
          <Button label={t('body3d.open')} variant="dark" leftIcon="cube-outline" fullWidth onPress={() => router.push('/body-3d')} />
          <AppText variant="label" color="textSecondary">{t('body.orChoose')}</AppText>
          <View accessibilityRole="radiogroup" style={[styles.wrap, { gap: spacing.sm }]}>
            {BODY_SYSTEM_IDS.map((id) => {
              const active = id === selectedSystem;
              return (
                <PressableScale
                  key={id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  onPress={() => setSelectedSystem(id)}
                  style={{
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    borderRadius: radius.pill,
                    backgroundColor: active ? colors.night : colors.surfaceAlt,
                    borderWidth: 1,
                    borderColor: active ? colors.night : colors.border,
                  }}
                >
                  <AppText variant="label" style={{ color: active ? colors.onNight : colors.text }}>{t(`systems.${id}.short`)}</AppText>
                </PressableScale>
              );
            })}
          </View>
        </Card>
      </FadeInView>

      {system && (
        <>
          <FadeInView index={2} key={`h-${system.id}`}>
            <Card style={{ gap: spacing.md }}>
              <View style={[styles.row, { gap: spacing.md }]}>
                <View style={[styles.iconTile, { backgroundColor: colors.surfaceTinted, borderRadius: radius.button }]}>
                  <SystemIcon id={system.id} size={28} color={colors.primaryText} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="h2">{t(`systems.${system.id}.name`)}</AppText>
                </View>
              </View>
              <StatusBadge status={system.status} size="lg" />
              <AppText color="textSecondary">{t(`systems.${system.id}.role`)}</AppText>
              <View style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.status[system.status].background, borderWidth: 1, borderColor: colors.status[system.status].ring }}>
                <AppText variant="bodySmall" style={{ color: colors.status[system.status].text }}>{t(`body.callout.${system.status}`)}</AppText>
              </View>
            </Card>
          </FadeInView>

          {system.indicators.map((ind, i) => (
            <FadeInView key={ind.id} index={3 + i}>
              <IndicatorCard indicator={ind} onDetails={() => comingSoon(t('body.details'))} onMeasure={() => (isMeasurable(ind.id) ? router.push({ pathname: '/measure', params: { indicator: ind.id } }) : comingSoon(t('body.measure')))} />
            </FadeInView>
          ))}

          <FadeInView index={3 + system.indicators.length} key={`r-${system.id}`}>
            <Card style={{ gap: spacing.md }}>
              <View style={[styles.row, { gap: spacing.sm }]}>
                <Ionicons name="bulb-outline" size={20} color={colors.primaryText} />
                <AppText variant="h3">{t('body.recommendations')}</AppText>
              </View>
              {(t(`systems.${system.id}.recommendations`, { returnObjects: true }) as string[]).map((rec) => (
                <View key={rec} style={[styles.row, { gap: spacing.sm, alignItems: 'flex-start' }]}>
                  <View style={[styles.dot, { backgroundColor: colors.primary }]} />
                  <AppText style={styles.flex}>{rec}</AppText>
                </View>
              ))}
              <AppText variant="caption" color="textMuted">{t('body.protocolNote')}</AppText>
            </Card>
          </FadeInView>
        </>
      )}
    </Screen>
  );
}

function IndicatorCard({ indicator, onDetails, onMeasure }: { indicator: HealthIndicator; onDetails: () => void; onMeasure: () => void }) {
  const { t } = useTranslation();
  const { spacing } = useAppTheme();
  const r = indicator.latest;
  return (
    <Card style={{ gap: spacing.md }}>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <AppText variant="title" style={styles.flex}>{t(`indicators.${indicator.id}.name`)}</AppText>
        <StatusBadge status={indicator.status} size="sm" />
      </View>
      <View style={[styles.row, { gap: spacing.md }]}>
        <View style={styles.flex}>
          <View style={[styles.row, { gap: 6, alignItems: 'baseline' }]}>
            <AppText variant="display" style={{ fontSize: 32, lineHeight: 38, fontVariant: ['tabular-nums'] }}>{formatValue(indicator)}</AppText>
            <AppText color="textMuted">{indicator.unit}</AppText>
          </View>
          <AppText variant="caption" color="textMuted">
            {r ? `${timeAgo(r.takenAt, t)} · ${t(`health.source.${r.source}`)}${r.synced ? '' : ` · ${t('health.onDevice')}`}` : t('body.noReadings')}
          </AppText>
        </View>
        <Sparkline data={indicator.trend} />
      </View>
      <AppText variant="bodySmall" color="textSecondary">{t(`indicators.${indicator.id}.description`)}</AppText>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Button label={t('body.details')} variant="secondary" size="sm" onPress={onDetails} />
        <Button label={t('body.measure')} leftIcon="add" size="sm" onPress={onMeasure} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1 },
  iconTile: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 9 },
});
