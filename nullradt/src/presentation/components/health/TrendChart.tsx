import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import type { HistoryPoint } from '@/domain/usecases/IndicatorHistory';
import type { IndicatorRule } from '@/domain/rules/ruleEngine';
import { AppText } from '@/presentation/components/ui';

const APath = Animated.createAnimatedComponent(Path);
const PAD = { top: 12, right: 12, bottom: 24, left: 40 };

export interface TrendChartProps {
  points: HistoryPoint[];
  unit: string;
  bands?: IndicatorRule['bands'];
  /** Línea base personal (rango habitual). */
  personalRange?: { min: number; max: number };
  height?: number;
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/**
 * Gráfica dinámica de la evolución de un indicador:
 * bandas del semáforo (regla citada), rango personal punteado, línea animada que se "dibuja",
 * puntos coloreados por estado y selección al tocar.
 */
export function TrendChart({ points, unit, bands, personalRange, height = 220 }: TrendChartProps) {
  const { t, i18n } = useTranslation();
  const { colors, radius, spacing } = useAppTheme();
  const [width, setWidth] = useState(0);
  // Selección ligada a la serie: al cambiar de periodo vuelve a la última lectura (sin setState en un efecto).
  const [pickedFor, setPicked] = useState<{ key: string; index: number } | null>(null);
  const progress = useSharedValue(0);

  // Redibuja al cambiar el periodo o llegar una medición nueva.
  const key = `${points.length}-${points[0]?.at ?? 0}-${points[points.length - 1]?.at ?? 0}`;
  const selected = pickedFor?.key === key ? pickedFor.index : points.length ? points.length - 1 : null;
  const setSelected = (index: number) => setPicked({ key, index });
  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const geo = useMemo(() => {
    if (width === 0 || points.length === 0) return null;
    const values = points.flatMap((p) => (p.secondary !== undefined ? [p.value, p.secondary] : [p.value]));
    const extra = [...(bands ? [bands.normal[0], bands.normal[1]] : []), ...(personalRange ? [personalRange.min, personalRange.max] : [])];
    const vmin = Math.min(...values);
    const vmax = Math.max(...values);
    const vspan = vmax - vmin || Math.abs(vmax) * 0.1 || 1;
    // Las bandas/rango personal entran en la escala solo si están cerca de los datos (si no, aplastan la línea).
    const near = extra.filter((v) => v >= vmin - vspan * 1.5 && v <= vmax + vspan * 1.5);
    let min = Math.min(vmin, ...near);
    let max = Math.max(vmax, ...near);
    const span = max - min || 1;
    min -= span * 0.12;
    max += span * 0.12;
    const t0 = points[0]!.at;
    const t1 = points[points.length - 1]!.at;
    const w = width - PAD.left - PAD.right;
    const h = height - PAD.top - PAD.bottom;
    const x = (at: number) => PAD.left + (t1 === t0 ? w / 2 : ((at - t0) / (t1 - t0)) * w);
    const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * h;
    const line = (get: (p: HistoryPoint) => number | undefined) => {
      let d = '';
      let len = 0;
      let last: [number, number] | null = null;
      points.forEach((p) => {
        const v = get(p);
        if (v === undefined) return;
        const pt: [number, number] = [x(p.at), y(v)];
        d += `${last ? 'L' : 'M'}${pt[0].toFixed(1)} ${pt[1].toFixed(1)} `;
        if (last) len += Math.hypot(pt[0] - last[0], pt[1] - last[1]);
        last = pt;
      });
      return { d, len: Math.max(len, 1) };
    };
    return { min, max, x, y, w, h, main: line((p) => p.value), sec: line((p) => p.secondary) };
  }, [width, points, bands, personalRange, height]);

  const mainProps = useAnimatedProps(() => ({ strokeDashoffset: (geo?.main.len ?? 0) * (1 - progress.value) }));
  const secProps = useAnimatedProps(() => ({ strokeDashoffset: (geo?.sec.len ?? 0) * (1 - progress.value) }));

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const pick = (locationX: number) => {
    if (!geo) return;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(geo.x(p.at) - locationX) < Math.abs(geo.x(points[best]!.at) - locationX)) best = i;
    });
    setSelected(best);
  };

  const date = (at: number) => new Date(at).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
  const sel = selected !== null ? points[selected] : undefined;
  const band = (lo: number, hi: number, fill: string, k: string) => {
    if (!geo) return null;
    const top = geo.y(Math.min(hi, geo.max));
    const bottom = geo.y(Math.max(lo, geo.min));
    if (bottom <= top) return null;
    return <Rect key={k} x={PAD.left} y={top} width={geo.w} height={bottom - top} fill={fill} />;
  };

  if (points.length === 0) {
    return (
      <View style={[styles.empty, { height, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }]}>
        <AppText color="textMuted">{t('indicatorDetail.noData')}</AppText>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {sel && (
        <View style={[styles.row, { gap: spacing.sm }]}>
          <View style={[styles.dot, { backgroundColor: colors.status[sel.status].solid }]} />
          <AppText variant="title" style={{ fontVariant: ['tabular-nums'] }}>
            {sel.secondary !== undefined ? `${fmt(sel.value)}/${fmt(sel.secondary)}` : fmt(sel.value)} {unit}
          </AppText>
          <AppText variant="caption" color="textMuted" style={styles.flex} numberOfLines={1}>
            {new Date(sel.at).toLocaleString(i18n.language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {' · '}
            {sel.synthetic ? t('indicatorDetail.synthetic') : t(`health.source.${sel.source}`)}
          </AppText>
        </View>
      )}
      <Pressable
        onLayout={onLayout}
        onPress={(e) => pick(e.nativeEvent.locationX)}
        accessibilityRole="adjustable"
        accessibilityLabel={t('indicatorDetail.chartA11y', { count: points.length })}
        style={{ height }}
      >
        {geo && (
          <Svg width={width} height={height}>
            {bands && band(bands.normal[0], bands.normal[1], colors.status.normal.background, 'n')}
            {bands?.caution?.map(([lo, hi], i) => band(lo, hi, colors.status.caution.background, `c${i}`))}
            {personalRange && (
              <>
                <Line x1={PAD.left} x2={PAD.left + geo.w} y1={geo.y(personalRange.min)} y2={geo.y(personalRange.min)} stroke={colors.tertiary} strokeDasharray="4 4" strokeWidth={1} />
                <Line x1={PAD.left} x2={PAD.left + geo.w} y1={geo.y(personalRange.max)} y2={geo.y(personalRange.max)} stroke={colors.tertiary} strokeDasharray="4 4" strokeWidth={1} />
              </>
            )}
            <Line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={PAD.top + geo.h} stroke={colors.border} />
            <Line x1={PAD.left} x2={PAD.left + geo.w} y1={PAD.top + geo.h} y2={PAD.top + geo.h} stroke={colors.border} />
            {geo.sec.d !== '' && (
              <APath d={geo.sec.d} fill="none" stroke={colors.textMuted} strokeWidth={2} strokeDasharray={[geo.sec.len, geo.sec.len]} animatedProps={secProps} strokeLinejoin="round" />
            )}
            <APath d={geo.main.d} fill="none" stroke={colors.text} strokeWidth={2.5} strokeDasharray={[geo.main.len, geo.main.len]} animatedProps={mainProps} strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p, i) => (
              <Circle
                key={`${p.at}-${i}`}
                cx={geo.x(p.at)}
                cy={geo.y(p.value)}
                r={i === selected ? 6 : p.synthetic ? 2.5 : 4}
                fill={p.status === 'unevaluated' ? colors.status.unevaluated.solid : colors.status[p.status].solid}
                stroke={i === selected ? colors.text : p.synthetic ? 'none' : colors.surface}
                strokeWidth={i === selected ? 2 : 1.5}
              />
            ))}
            {sel && <Line x1={geo.x(sel.at)} x2={geo.x(sel.at)} y1={PAD.top} y2={PAD.top + geo.h} stroke={colors.textMuted} strokeWidth={1} strokeDasharray="2 3" />}
          </Svg>
        )}
        {geo && (
          <>
            <AppText variant="caption" color="textMuted" style={[styles.axis, { top: PAD.top - 6, width: PAD.left - 6 }]}>{fmt(Math.round(geo.max * 10) / 10)}</AppText>
            <AppText variant="caption" color="textMuted" style={[styles.axis, { top: PAD.top + geo.h - 10, width: PAD.left - 6 }]}>{fmt(Math.round(geo.min * 10) / 10)}</AppText>
            <AppText variant="caption" color="textMuted" style={[styles.xLabel, { left: PAD.left }]}>{date(points[0]!.at)}</AppText>
            <AppText variant="caption" color="textMuted" style={[styles.xLabel, { right: PAD.right }]}>{date(points[points.length - 1]!.at)}</AppText>
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  empty: { alignItems: 'center', justifyContent: 'center' },
  axis: { position: 'absolute', left: 0, textAlign: 'right' },
  xLabel: { position: 'absolute', bottom: 0 },
});
