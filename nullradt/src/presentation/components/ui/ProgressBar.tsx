import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useAppTheme } from '@/core/theme';
import { AppText } from './AppText';

export interface ProgressBarProps {
  /** 0–1 */
  value: number;
  color: string;
  label?: string;
  delay?: number;
  /** Etiqueta clara para usar sobre superficies oscuras (night). */
  onDark?: boolean;
}

/** Barra gruesa y redondeada que se llena al montar. */
export function ProgressBar({ value, color, label, delay = 0, onDark }: ProgressBarProps) {
  const { colors, radius, spacing, motion } = useAppTheme();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(Math.min(Math.max(value, 0), 1), { duration: motion.duration.slow * 2, easing: Easing.out(Easing.cubic) }),
    );
  }, [value, delay, motion.duration.slow, progress]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <View style={{ gap: spacing.xs }}>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
        style={[styles.track, { backgroundColor: onDark ? colors.nightChip : colors.progressTrack, borderRadius: radius.pill }]}
      >
        <Animated.View style={[styles.fill, { backgroundColor: color, borderRadius: radius.pill }, fillStyle]} />
      </View>
      {label ? <AppText variant="caption" color="textSecondary" style={onDark ? { color: colors.onNightMuted } : undefined}>{label}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, overflow: 'hidden' },
  fill: { height: '100%' },
});
