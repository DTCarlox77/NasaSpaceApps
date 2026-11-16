import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useAppTheme } from '@/core/theme';
import { AppText } from './AppText';

const THUMB = 32;

/**
 * Escala visual análoga (VAS) SIN números: el astronauta marca un punto entre dos extremos.
 * Valor interno 0–100 (nunca se muestra, para no anclar la respuesta). Accesible con gestos de ajuste.
 */
export function VasSlider({
  label,
  low,
  high,
  value,
  onChange,
}: {
  label: string;
  low: string;
  high: string;
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  const { colors, spacing, radius } = useAppTheme();
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  const touched = value !== undefined;

  useEffect(() => {
    if (width) x.set(((value ?? 50) / 100) * width);
  }, [width, value, x]);

  const commit = (px: number) => {
    const v = Math.round((Math.max(0, Math.min(width, px)) / width) * 100);
    onChange(v);
  };
  const tick = () => Haptics.selectionAsync().catch(() => {});

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      x.set(Math.max(0, Math.min(width, e.x)));
      runOnJS(tick)();
    })
    .onUpdate((e) => {
      x.set(Math.max(0, Math.min(width, e.x)));
    })
    .onFinalize(() => {
      runOnJS(commit)(x.get());
    });

  const fill = useAnimatedStyle(() => ({ width: x.value }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value - THUMB / 2 }] }));
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const step = (d: number) => onChange(Math.max(0, Math.min(100, (value ?? 50) + d)));

  return (
    <View style={{ gap: spacing.sm }}>
      <AppText variant="title">{label}</AppText>
      <GestureDetector gesture={pan}>
        <View
          onLayout={onLayout}
          style={styles.hit}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`${label}: ${low} — ${high}`}
          accessibilityValue={{ min: 0, max: 100, now: value ?? 50 }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 10 : -10)}
        >
          <View style={[styles.track, { backgroundColor: colors.progressTrack, borderRadius: radius.pill }]}>
            <Animated.View style={[styles.fill, { backgroundColor: touched ? colors.tertiary : 'transparent', borderRadius: radius.pill }, fill]} />
          </View>
          <Animated.View
            style={[
              styles.thumb,
              { backgroundColor: touched ? colors.surface : colors.surfaceAlt, borderColor: touched ? colors.tertiary : colors.borderStrong },
              thumb,
            ]}
          />
        </View>
      </GestureDetector>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <AppText variant="caption" color="textMuted">{low}</AppText>
        <AppText variant="caption" color="textMuted">{high}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  hit: { height: 44, justifyContent: 'center' },
  track: { height: 10, overflow: 'hidden' },
  fill: { height: 10 },
  thumb: { position: 'absolute', left: 0, width: THUMB, height: THUMB, borderRadius: THUMB / 2, borderWidth: 3 },
});
