import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppText, PressableScale } from '@/presentation/components/ui';
import { useAuthStore } from '@/presentation/store/authStore';
import { useVoiceStore, voiceSupported, wakeManually } from './voiceAssistant';

/**
 * Indicador del asistente: discreto mientras espera "NullRadt"; se expande al escuchar, pensar o hablar.
 * Tocarlo = decir "NullRadt" (por si hay ruido). Mantenerlo = lista de comandos.
 */
export function VoiceOverlay() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { enabled, status, transcript, lastReply } = useVoiceStore();
  const unlocked = useAuthStore((s) => s.status === 'unlocked');
  const pulse = useSharedValue(0);
  const expanded = status === 'awake' || status === 'thinking' || status === 'speaking' || status === 'dialog';

  useEffect(() => {
    if (status === 'awake' || status === 'dialog') pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
    else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
  }, [status, pulse]);
  const ring = useAnimatedStyle(() => ({ opacity: 0.25 + pulse.value * 0.5, transform: [{ scale: 1 + pulse.value * 0.35 }] }));

  if (!voiceSupported || !enabled || !unlocked || status === 'off' || status === 'unsupported') return null;

  const icon: keyof typeof Ionicons.glyphMap =
    status === 'speaking' ? 'volume-high' : status === 'thinking' ? 'ellipsis-horizontal' : status === 'error' ? 'mic-off' : status === 'paused' ? 'mic-off-outline' : 'mic';
  const line =
    status === 'awake' || status === 'dialog'
      ? transcript || t('assistant.overlay.listening')
      : status === 'thinking'
        ? t('assistant.overlay.thinking')
        : status === 'speaking'
          ? lastReply
          : status === 'error'
            ? t('assistant.overlay.error')
            : t('assistant.overlay.idle');

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end', alignItems: expanded ? 'stretch' : 'flex-start' }]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('assistant.overlay.a11y')}
        onPress={wakeManually}
        onLongPress={() => router.push('/voice-commands')}
        style={[
          styles.pill,
          {
            marginBottom: insets.bottom + 84,
            marginHorizontal: spacing.lg,
            gap: spacing.sm,
            paddingHorizontal: spacing.md,
            paddingVertical: expanded ? spacing.md : spacing.xs + 2,
            borderRadius: radius.pill,
            backgroundColor: expanded ? colors.night : 'rgba(31,31,31,0.72)',
          },
        ]}
      >
        <View style={styles.iconWrap}>
          {expanded && <Animated.View style={[styles.ring, { backgroundColor: colors.primary }, ring]} />}
          <Ionicons name={icon} size={expanded ? 20 : 14} color={status === 'error' ? colors.accent : colors.primary} />
        </View>
        <AppText variant={expanded ? 'bodySmall' : 'caption'} numberOfLines={expanded ? 3 : 1} style={{ color: colors.onNight, flexShrink: 1 }}>
          {line}
        </AppText>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center' },
  iconWrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 24, height: 24, borderRadius: 12 },
});
