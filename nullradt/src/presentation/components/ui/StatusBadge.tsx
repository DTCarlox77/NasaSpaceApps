import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useAppTheme, type StatusKey } from '@/core/theme';
import { AppText } from './AppText';

/** Íconos del sistema de estados del Figma (circle-check, triangle-alert, octagon-alert, circle-dashed). */
export const STATUS_ICON: Record<StatusKey, keyof typeof Ionicons.glyphMap> = {
  normal: 'checkmark-circle',
  caution: 'warning',
  critical: 'alert-circle',
  unevaluated: 'ellipse-outline',
};

export interface StatusBadgeProps {
  status: StatusKey;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Chip del semáforo (Figma Badge): redondeado, negrita, anillo de 1px, fondo suave e ícono.
 * Nunca depende solo del color: siempre lleva ícono + texto. El crítico pulsa suavemente.
 */
export function StatusBadge({ status, label, size = 'md' }: StatusBadgeProps) {
  const { t } = useTranslation();
  const { colors, radius, spacing, motion } = useAppTheme();
  const c = colors.status[status];
  const pulse = useSharedValue(0);
  const text = label ?? t(`status.${status}`);
  const iconSize = size === 'lg' ? 20 : size === 'sm' ? 14 : 16;

  useEffect(() => {
    if (status !== 'critical') return;
    pulse.value = withRepeat(withTiming(1, { duration: motion.duration.pulse, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(pulse);
  }, [status, motion.duration.pulse, pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.5 * (1 - pulse.value),
    transform: [{ scale: 1 + pulse.value * 0.9 }],
  }));

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={text}
      style={[
        styles.row,
        {
          backgroundColor: c.background,
          borderColor: c.ring,
          borderRadius: radius.pill,
          paddingHorizontal: size === 'sm' ? spacing.sm : spacing.md,
          paddingVertical: size === 'lg' ? spacing.sm : 3,
          gap: spacing.xs,
        },
      ]}
    >
      <View style={{ width: iconSize, height: iconSize, alignItems: 'center', justifyContent: 'center' }}>
        {status === 'critical' && (
          <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: iconSize, backgroundColor: c.solid }, ringStyle]} />
        )}
        <Ionicons name={STATUS_ICON[status]} size={iconSize} color={status === 'unevaluated' ? c.text : c.solid} />
      </View>
      <AppText variant="label" style={{ color: c.text, fontSize: size === 'lg' ? 16 : size === 'sm' ? 12 : 14 }}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderWidth: 1 },
});
