import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppTheme } from '@/core/theme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

/** Variantes del Figma: primary, secondary (salvia), outline, ghost, danger (crit-600), dark (night). */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'dark';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Ícono a la derecha (flechas) — `leftIcon` para íconos de acción. */
  icon?: keyof typeof Ionicons.glyphMap;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  fullWidth?: boolean;
  loading?: boolean;
  disabled?: boolean;
}

const HEIGHT: Record<ButtonSize, number> = { sm: 40, md: 48, lg: 56, xl: 64 };
const FONT: Record<ButtonSize, number> = { sm: 14, md: 15, lg: 16, xl: 18 };

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  leftIcon,
  fullWidth,
  loading,
  disabled,
}: ButtonProps) {
  const { colors, radius, spacing } = useAppTheme();

  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: colors.primary, fg: colors.onPrimary },
    secondary: { bg: colors.secondary, fg: colors.onSecondary },
    outline: { bg: colors.surface, fg: colors.text, border: colors.borderStrong },
    ghost: { bg: 'transparent', fg: colors.textSecondary },
    danger: { bg: colors.dangerStrong, fg: '#FFFFFF' },
    dark: { bg: colors.night, fg: colors.onNight },
  };
  const { bg, fg, border } = palette[variant];
  const inactive = disabled || loading;

  return (
    <PressableScale
      onPress={inactive ? undefined : onPress}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      style={[
        styles.base,
        {
          height: HEIGHT[size],
          borderRadius: radius.button,
          paddingHorizontal: size === 'sm' ? spacing.lg : spacing.xl,
          backgroundColor: bg,
          borderWidth: border ? 1 : 0,
          borderColor: border,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <View style={[styles.row, { gap: spacing.sm }]}>
        {loading ? (
          <ActivityIndicator size="small" color={fg} />
        ) : leftIcon ? (
          <Ionicons name={leftIcon} size={FONT[size] + 3} color={fg} />
        ) : null}
        <AppText variant="button" numberOfLines={1} style={{ color: fg, fontSize: FONT[size] }}>
          {label}
        </AppText>
        {icon && !loading ? <Ionicons name={icon} size={FONT[size] + 2} color={fg} /> : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { justifyContent: 'center', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
});
