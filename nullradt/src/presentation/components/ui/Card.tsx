import type { PropsWithChildren } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useAppTheme } from '@/core/theme';
import { PressableScale } from './PressableScale';

export interface CardProps extends PropsWithChildren {
  /** surface (blanca), alt (surface-2), tinted (brand-50), sage (sage-50), night (oscura). */
  tone?: 'surface' | 'alt' | 'tinted' | 'sage' | 'night';
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/** Figma Card: rounded 20, p-5, shadow-card, ring-1 line/60. */
export function Card({ tone = 'surface', onPress, style, children, accessibilityLabel }: CardProps) {
  const { colors, radius, spacing, shadows } = useAppTheme();
  const bg = {
    surface: colors.surface,
    alt: colors.surfaceAlt,
    tinted: colors.surfaceTinted,
    sage: colors.surfaceSage,
    night: colors.night,
  }[tone];
  const cardStyle: StyleProp<ViewStyle> = [
    { backgroundColor: bg, borderRadius: radius.lg, padding: spacing.xl, borderWidth: 1, borderColor: tone === 'night' ? 'transparent' : colors.border },
    tone === 'surface' ? shadows.md : null,
    style,
  ];

  if (onPress) {
    return (
      <PressableScale onPress={onPress} style={cardStyle} accessibilityLabel={accessibilityLabel}>
        {children}
      </PressableScale>
    );
  }
  return <View style={cardStyle}>{children}</View>;
}
