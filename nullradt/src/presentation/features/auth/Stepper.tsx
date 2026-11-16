import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppTheme } from '@/core/theme';
import { AppText } from '@/presentation/components/ui';

/** Indicador de pasos (Figma): activo = night, completado = brand con check, pendiente = surface-2. */
export function Stepper({ steps, current, label }: { steps: string[]; current: number; label: string }) {
  const { colors, spacing } = useAppTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 1, max: steps.length, now: current + 1 }} style={[styles.row, { gap: spacing.sm }]}>
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const bg = done ? colors.primary : active ? colors.night : colors.surfaceAlt;
        const fg = done ? colors.onPrimary : active ? colors.onNight : colors.textMuted;
        return (
          <View key={step} style={[styles.row, { gap: spacing.sm }]}>
            {i > 0 && <View style={[styles.connector, { backgroundColor: done || active ? colors.primary : colors.borderStrong }]} />}
            <View style={[styles.circle, { backgroundColor: bg }]}>
              {done ? <Ionicons name="checkmark" size={16} color={fg} /> : <AppText variant="label" style={{ color: fg }}>{i + 1}</AppText>}
            </View>
            <AppText variant="label" color={active ? 'text' : 'textMuted'}>{step}</AppText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  circle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  connector: { width: 32, height: 2, borderRadius: 1 },
});
