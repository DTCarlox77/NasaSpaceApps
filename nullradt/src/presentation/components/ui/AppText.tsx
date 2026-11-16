import { Text, type TextProps } from 'react-native';
import { useAppTheme, type TypographyVariant } from '@/core/theme';

type ColorKey = 'text' | 'textSecondary' | 'textMuted' | 'primaryText' | 'accentText' | 'dangerText' | 'onPrimary';

export interface AppTextProps extends TextProps {
  variant?: TypographyVariant;
  color?: ColorKey;
  align?: 'left' | 'center' | 'right';
}

/** Texto tipado: aplica fuente, tamaño y color del tema. Nunca uses <Text> suelto. */
export function AppText({ variant = 'body', color = 'text', align, style, ...rest }: AppTextProps) {
  const { typography, colors } = useAppTheme();
  return (
    <Text
      maxFontSizeMultiplier={1.6}
      style={[typography[variant], { color: colors[color], textAlign: align }, style]}
      {...rest}
    />
  );
}
