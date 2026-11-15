import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppText, PressableScale } from '@/presentation/components/ui';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

/** Teclado de PIN de 6 dígitos (teclas grandes: guantes y microgravedad). */
export function PinPad({ onComplete, disabled, error }: { onComplete: (pin: string) => Promise<boolean | void> | void; disabled?: boolean; error?: string | null }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const [pin, setPin] = useState('');

  const press = async (k: (typeof KEYS)[number]) => {
    if (disabled || !k) return;
    Haptics.selectionAsync().catch(() => {});
    if (k === 'del') return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, 6);
    setPin(next);
    if (next.length === 6) {
      const ok = await onComplete(next);
      if (ok !== true) setPin('');
    }
  };

  return (
    <View style={{ gap: spacing.lg, alignItems: 'center' }}>
      <View style={[styles.row, { gap: spacing.md }]} accessibilityLabel={t('access.pinProgress', { count: pin.length })}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={i} style={[styles.dot, { borderColor: colors.borderStrong, backgroundColor: i < pin.length ? colors.text : 'transparent' }]} />
        ))}
      </View>
      {error ? <AppText variant="bodySmall" color="dangerText" align="center">{error}</AppText> : null}
      <View style={[styles.grid, { gap: spacing.sm }]}>
        {KEYS.map((k, i) => (
          <PressableScale
            key={`${k}-${i}`}
            disabled={!k || disabled}
            onPress={() => press(k)}
            accessibilityLabel={k === 'del' ? t('access.pinDelete') : k}
            style={[styles.key, { borderRadius: radius.button, backgroundColor: k ? colors.surfaceAlt : 'transparent', opacity: disabled ? 0.5 : 1 }]}
          >
            {k === 'del' ? <Ionicons name="backspace-outline" size={24} color={colors.text} /> : <AppText variant="h2">{k}</AppText>}
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 3 * 76 + 2 * 8, justifyContent: 'center' },
  key: { width: 76, height: 60, alignItems: 'center', justifyContent: 'center' },
});
