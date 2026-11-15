import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useAppTheme, type StatusKey } from '@/core/theme';
import type { BodySystemId, HealthIndicator } from '@/domain/entities/HealthIndicator';
import { AppText, PressableScale } from '@/presentation/components/ui';
import { STATUS_ICON } from '@/presentation/components/ui/StatusBadge';

/** Íconos de sistemas (Figma lucide: heart, wind, brain, eye, bone, dumbbell, shield-plus). */
export const SYSTEM_ICON: Record<BodySystemId, keyof typeof MaterialCommunityIcons.glyphMap> = {
  cardiovascular: 'heart-pulse',
  respiratory: 'weather-windy',
  brain: 'brain',
  eyes: 'eye-outline',
  skeletal: 'bone',
  muscular: 'arm-flex-outline',
  immune: 'shield-plus-outline',
  metabolism: 'food-apple-outline',
};

export function SystemIcon({ id, size = 22, color }: { id: BodySystemId; size?: number; color: string }) {
  return <MaterialCommunityIcons name={SYSTEM_ICON[id]} size={size} color={color} />;
}

/** "118/76" para presión, "36.9" para temperatura, etc. */
export function formatValue(ind: HealthIndicator): string {
  const r = ind.latest;
  if (!r) return '—';
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  return r.secondaryValue !== undefined ? `${fmt(r.value)}/${fmt(r.secondaryValue)}` : fmt(r.value);
}

/** "hace 2 h", "hace 3 d". */
export function timeAgo(iso: string, t: TFunction): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return t('time.minutesAgo', { count: mins });
  const h = Math.round(mins / 60);
  if (h < 48) return t('time.hoursAgo', { count: h });
  return t('time.daysAgo', { count: Math.round(h / 24) });
}

const LEGEND: StatusKey[] = ['normal', 'caution', 'critical', 'unevaluated'];

/** Leyenda del semáforo (Figma): ícono + etiqueta por estado. */
export function StatusLegend() {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();
  return (
    <View style={[styles.wrap, { gap: spacing.md }]}>
      {LEGEND.map((s) => (
        <View key={s} style={[styles.row, { gap: 4 }]}>
          <Ionicons name={STATUS_ICON[s]} size={14} color={s === 'unevaluated' ? colors.status[s].text : colors.status[s].solid} />
          <AppText variant="caption" color="textSecondary">{t(`status.${s}`)}</AppText>
        </View>
      ))}
    </View>
  );
}

/** Fila de indicador dentro del panel de un sistema: punto de estado, nombre, valor + unidad, chevron. */
export function IndicatorRow({ indicator, onPress }: { indicator: HealthIndicator; onPress: () => void }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const c = colors.status[indicator.status];
  return (
    <PressableScale
      accessibilityLabel={`${t(`indicators.${indicator.id}.short`)}: ${formatValue(indicator)} ${indicator.unit}, ${t(`status.${indicator.status}`)}`}
      onPress={onPress}
      style={[styles.row, { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}
    >
      <Ionicons name={STATUS_ICON[indicator.status]} size={20} color={indicator.status === 'unevaluated' ? c.text : c.solid} />
      <AppText variant="label" style={styles.flex} numberOfLines={1}>{t(`indicators.${indicator.id}.short`)}</AppText>
      <AppText variant="title" style={{ fontVariant: ['tabular-nums'] }}>{formatValue(indicator)}</AppText>
      <AppText variant="caption" color="textMuted">{indicator.unit}</AppText>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </PressableScale>
  );
}

/** Mosaico del grid "Todos los indicadores": fondo suave si no es normal (Figma). */
export function IndicatorTile({ indicator, onPress }: { indicator: HealthIndicator; onPress: () => void }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const c = colors.status[indicator.status];
  const soft = indicator.status !== 'normal';
  return (
    <PressableScale
      accessibilityLabel={`${t(`indicators.${indicator.id}.short`)}: ${formatValue(indicator)} ${indicator.unit}, ${t(`status.${indicator.status}`)}`}
      onPress={onPress}
      style={[
        styles.tile,
        {
          gap: spacing.xs,
          padding: spacing.md,
          borderRadius: radius.button,
          backgroundColor: soft ? c.background : colors.surface,
          borderColor: soft ? c.ring : colors.border,
        },
      ]}
    >
      <View style={[styles.row, { gap: spacing.xs }]}>
        <AppText variant="label" color="textSecondary" style={styles.flex} numberOfLines={1}>{t(`indicators.${indicator.id}.short`)}</AppText>
        <Ionicons name={STATUS_ICON[indicator.status]} size={16} color={indicator.status === 'unevaluated' ? c.text : c.solid} />
      </View>
      <View style={[styles.row, { gap: 4, alignItems: 'baseline' }]}>
        <AppText variant="h2" style={{ fontVariant: ['tabular-nums'] }}>{formatValue(indicator)}</AppText>
        <AppText variant="caption" color="textMuted">{indicator.unit}</AppText>
      </View>
      <AppText variant="caption" style={{ color: c.text }}>{t(`status.${indicator.status}`)}</AppText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1 },
  tile: { borderWidth: 1 },
});
