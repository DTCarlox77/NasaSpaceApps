import { Platform, type ViewStyle } from 'react-native';
import { darkColors, lightColors, type ColorTokens } from './colors';
import { fontFamily, typography } from './typography';
import { hitSize, motion, radius, spacing } from './tokens';

export type ColorSchemeName = 'light' | 'dark';

function makeShadows(colors: ColorTokens, scheme: ColorSchemeName) {
  // Figma shadow-card ≈ 0 4px 16px -4px ink/6%; shadow-raised ≈ 0 12px 32px -8px ink/14%.
  const opacity = scheme === 'dark' ? 0.35 : 0.07;
  const shadow = (height: number, blur: number, elevation: number): ViewStyle =>
    Platform.select<ViewStyle>({
      android: { elevation },
      default: {
        shadowColor: colors.shadow,
        shadowOpacity: opacity,
        shadowRadius: blur,
        shadowOffset: { width: 0, height },
      },
    });
  return { sm: shadow(1, 3, 1), md: shadow(4, 10, 3), lg: shadow(10, 24, 8) };
}

function createTheme(scheme: ColorSchemeName) {
  const colors = scheme === 'dark' ? darkColors : lightColors;
  return {
    scheme,
    isDark: scheme === 'dark',
    colors,
    typography,
    fontFamily,
    spacing,
    radius,
    motion,
    hitSize,
    shadows: makeShadows(colors, scheme),
  };
}

export type AppTheme = ReturnType<typeof createTheme>;

export const themes: Record<ColorSchemeName, AppTheme> = {
  light: createTheme('light'),
  dark: createTheme('dark'),
};
