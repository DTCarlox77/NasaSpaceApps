import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme } from '@/core/theme';

/**
 * Tarjeta destacada de color sólido (salvia) con anillos decorativos.
 * Sustituye a los degradados: profundidad con formas planas, no con transiciones de color.
 */
export function HeroCard({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const { colors, radius, spacing } = useAppTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.hero, borderRadius: radius.xl, padding: spacing.xxl }, style]}>
      <View pointerEvents="none" style={[styles.ring, styles.ringLarge, { borderColor: colors.heroDecoration }]} />
      <View pointerEvents="none" style={[styles.ring, styles.ringSmall, { borderColor: colors.heroDecoration }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  ring: { position: 'absolute', borderRadius: 999 },
  ringLarge: { width: 220, height: 220, right: -70, bottom: -90, borderWidth: 28 },
  ringSmall: { width: 110, height: 110, right: 40, top: -50, borderWidth: 14 },
});
