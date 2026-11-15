import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle } from 'react-native-svg';
import { useAppTheme } from '@/core/theme';
import { AppText } from './AppText';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
/** Texto/ícono sobre el núcleo. Pasa un `color` oscuro (p. ej. red[600]) para contraste ≥ 4.5:1. */
const ON_COLOR = '#FFFFFF';

export interface HoldToConfirmButtonProps {
  label: string;
  hint: string;
  onConfirm: () => void;
  /** Tiempo que hay que mantener presionado (ms). */
  duration?: number;
  color: string;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  size?: number;
}

/**
 * Botón circular de "mantener para confirmar".
 * Un anillo se llena mientras se mantiene presionado; si se suelta antes, se vacía.
 * Evita envíos accidentales (guantes, microgravedad, toques sin querer).
 */
export function HoldToConfirmButton({
  label,
  hint,
  onConfirm,
  duration = 1500,
  color,
  icon = 'alert',
  disabled,
  size = 184,
}: HoldToConfirmButtonProps) {
  const { colors } = useAppTheme();
  const progress = useSharedValue(0);
  const scale = useSharedValue(1);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  const stroke = 10;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  const stopTicker = () => {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
  };
  useEffect(() => stopTicker, []);

  const complete = useCallback(() => {
    stopTicker();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onConfirm();
  }, [onConfirm]);

  const handlePressIn = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // Vibración ligera periódica para "sentir" el progreso.
    ticker.current = setInterval(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), 300);
    scale.value = withSpring(0.94, { damping: 15, stiffness: 220 });
    progress.value = withTiming(1, { duration: duration * (1 - progress.value), easing: Easing.linear }, (finished) => {
      if (finished) scheduleOnRN(complete);
    });
  };

  const handlePressOut = () => {
    stopTicker();
    scale.value = withSpring(1, { damping: 15, stiffness: 220 });
    if (progress.value < 1) {
      cancelAnimation(progress);
      progress.value = withTiming(0, { duration: 250, easing: Easing.out(Easing.quad) });
    }
  };

  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - progress.value) }));
  const containerStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      // Lectores de pantalla: la acción por defecto confirma directamente.
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'activate' && !disabled && complete()}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
    >
      <Animated.View style={[{ width: size, height: size }, containerStyle]}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.progressTrack} strokeWidth={stroke} fill="none" />
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            animatedProps={ringProps}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <View
          style={[
            styles.core,
            { margin: stroke + 8, borderRadius: size, backgroundColor: disabled ? colors.progressTrack : color },
          ]}
        >
          <Ionicons name={icon} size={44} color={ON_COLOR} />
          <AppText variant="button" align="center" style={{ color: ON_COLOR, marginTop: 4 }}>
            {label}
          </AppText>
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  core: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
});
