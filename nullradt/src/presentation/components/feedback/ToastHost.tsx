import { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { GestureDetector, usePanGesture, useTapGesture, useExclusiveGestures } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useAppTheme } from '@/core/theme';
import type { NotificationLevel } from '@/core/notifications/notificationService';
import { useToastStore, type Toast } from '@/presentation/store/toastStore';
import { AppText } from '../ui/AppText';

const ICONS: Record<NotificationLevel, keyof typeof Ionicons.glyphMap> = {
  info: 'information-circle',
  normal: 'checkmark-circle',
  caution: 'warning',
  critical: 'alert-circle',
};

const HIDDEN_Y = -220;

function InAppToast({ toast, onHidden }: { toast: Toast; onHidden: (id: string) => void }) {
  const { colors, radius, spacing, shadows } = useAppTheme();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(HIDDEN_Y);
  const progress = useSharedValue(1);
  const hiding = useSharedValue(false);

  const palette =
    toast.level === 'info'
      ? { solid: colors.tertiary, background: colors.surfaceTinted, text: colors.primaryText }
      : colors.status[toast.level];

  const finish = useCallback(() => onHidden(toast.id), [onHidden, toast.id]);

  const hide = useCallback(() => {
    'worklet';
    if (hiding.value) return;
    hiding.value = true;
    cancelAnimation(progress);
    translateY.value = withTiming(HIDDEN_Y, { duration: 220, easing: Easing.in(Easing.quad) }, (done) => {
      if (done) scheduleOnRN(finish);
    });
  }, [finish, hiding, progress, translateY]);

  const runProgress = useCallback(() => {
    'worklet';
    progress.value = withTiming(0, { duration: toast.duration * progress.value, easing: Easing.linear }, (done) => {
      if (done) hide();
    });
  }, [hide, progress, toast.duration]);

  useEffect(() => {
    const haptic =
      toast.level === 'critical'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        : toast.level === 'caution'
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
          : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    haptic.catch(() => {});
    translateY.value = withSpring(0, { damping: 18, stiffness: 180, overshootClamping: true });
    runProgress();
  }, [runProgress, toast.level, translateY]);

  // Al tocar se pausa la cuenta regresiva; al soltar se reanuda, o se cierra si se deslizó hacia arriba.
  const dragY = useSharedValue(0);
  const dragVelocity = useSharedValue(0);
  const pan = usePanGesture({
    onBegin: () => {
      'worklet';
      cancelAnimation(progress);
      dragY.value = 0;
      dragVelocity.value = 0;
    },
    onUpdate: (e) => {
      'worklet';
      dragY.value = e.translationY;
      dragVelocity.value = e.velocityY;
      if (!hiding.value) translateY.value = Math.min(e.translationY, 0) + Math.max(e.translationY, 0) * 0.15;
    },
    onFinalize: () => {
      'worklet';
      if (hiding.value) return;
      if (dragY.value < -40 || dragVelocity.value < -500) hide();
      else {
        translateY.value = withSpring(0, { damping: 18, stiffness: 220, overshootClamping: true });
        runProgress();
      }
    },
  });
  const tap = useTapGesture({
    onDeactivate: () => {
      'worklet';
      hide();
    },
  });
  const gesture = useExclusiveGestures(pan, tap);

  const containerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const barStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessibilityRole="alert"
        accessibilityLiveRegion={toast.level === 'critical' ? 'assertive' : 'polite'}
        style={[styles.wrap, { top: insets.top + spacing.sm, left: spacing.md, right: spacing.md }, containerStyle]}
      >
        <View style={[styles.card, shadows.lg, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg }]}>
          <View style={[styles.row, { padding: spacing.md, gap: spacing.md }]}>
            <View style={[styles.icon, { backgroundColor: palette.background, borderRadius: radius.pill }]}>
              <Ionicons name={ICONS[toast.level]} size={22} color={palette.solid} />
            </View>
            <View style={styles.flex}>
              <AppText variant="title" numberOfLines={1}>{toast.title}</AppText>
              {!!toast.body && <AppText variant="bodySmall" color="textSecondary" numberOfLines={3}>{toast.body}</AppText>}
            </View>
          </View>
          <View style={[styles.track, { backgroundColor: colors.progressTrack }]}>
            <Animated.View style={[styles.bar, { backgroundColor: palette.solid }, barStyle]} />
          </View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

/** Montar una sola vez en la raíz. Muestra los avisos de la cola de uno en uno. */
export function ToastHost() {
  const current = useToastStore((s) => s.queue[0]);
  const dismiss = useToastStore((s) => s.dismiss);
  if (!current) return null;
  return <InAppToast key={current.id} toast={current} onHidden={dismiss} />;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', zIndex: 1000, elevation: 1000 },
  card: { borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  track: { height: 4 },
  bar: { height: '100%' },
});
