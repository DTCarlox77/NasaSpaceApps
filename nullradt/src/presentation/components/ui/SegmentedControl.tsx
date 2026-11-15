import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { Easing, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useAppTheme } from '@/core/theme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * Selector segmentado (Figma): pista surface-2 con borde, segmento activo blanco con sombra.
 * El ancho se mide en el contenedor interior y la pista recorta su contenido,
 * así el indicador nunca se sale del widget. Transición sin rebote.
 */
export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  const { colors, radius, spacing, motion, shadows } = useAppTheme();
  const [innerWidth, setInnerWidth] = useState(0);
  const segment = innerWidth / options.length;
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  const indicatorStyle = useAnimatedStyle(() => ({
    width: segment,
    transform: [
      { translateX: withTiming(index * segment, { duration: motion.duration.normal, easing: Easing.bezier(0.2, 0, 0, 1) }) },
    ],
  }));

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.track, { backgroundColor: colors.surfaceAlt, borderRadius: radius.button, padding: spacing.xs, borderColor: colors.border }]}
    >
      <View style={styles.inner} onLayout={(e: LayoutChangeEvent) => setInnerWidth(e.nativeEvent.layout.width)}>
        {innerWidth > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[styles.indicator, shadows.sm, { borderRadius: radius.md, backgroundColor: colors.surface, borderColor: colors.border }, indicatorStyle]}
          />
        )}
        {options.map((o) => {
          const selected = o.value === value;
          const color = selected ? colors.text : colors.textSecondary;
          return (
            <PressableScale
              key={o.value}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => onChange(o.value)}
              style={[styles.segment, { gap: spacing.xs }]}
            >
              {o.icon && <Ionicons name={o.icon} size={16} color={selected ? colors.primaryText : colors.textMuted} />}
              <AppText variant="button" numberOfLines={1} style={{ color, fontSize: 14 }}>
                {o.label}
              </AppText>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { borderWidth: 1, overflow: 'hidden' },
  inner: { flexDirection: 'row' },
  indicator: { position: 'absolute', top: 0, bottom: 0, left: 0, borderWidth: 1 },
  segment: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 40, paddingHorizontal: 4 },
});
