import type { TextStyle } from 'react-native';

/**
 * Familias tipográficas (archivos locales en assets/fonts).
 * - Primaria: Atkinson Hyperlegible -> cuerpo, etiquetas, datos (máxima legibilidad).
 * - Secundaria: Lexend -> títulos, botones y cifras destacadas.
 * Las claves deben coincidir con las de `src/core/fonts/fonts.ts`.
 */
export const fontFamily = {
  primary: 'AtkinsonHyperlegible-Regular',
  primaryItalic: 'AtkinsonHyperlegible-Italic',
  primaryBold: 'AtkinsonHyperlegible-Bold',
  secondaryLight: 'Lexend-Light',
  secondary: 'Lexend-Regular',
  secondaryMedium: 'Lexend-Medium',
  secondarySemiBold: 'Lexend-SemiBold',
  secondaryBold: 'Lexend-Bold',
} as const;

export const typography = {
  // Figma: títulos Lexend semibold, letterSpacing -.01em, lineHeight 1.2; cuerpo Atkinson lineHeight 1.55.
  display: { fontFamily: fontFamily.secondarySemiBold, fontSize: 36, lineHeight: 43, letterSpacing: -0.4 },
  h1: { fontFamily: fontFamily.secondarySemiBold, fontSize: 28, lineHeight: 34, letterSpacing: -0.3 },
  h2: { fontFamily: fontFamily.secondarySemiBold, fontSize: 22, lineHeight: 27, letterSpacing: -0.2 },
  h3: { fontFamily: fontFamily.secondarySemiBold, fontSize: 18, lineHeight: 22 },
  title: { fontFamily: fontFamily.secondarySemiBold, fontSize: 16, lineHeight: 21 },
  body: { fontFamily: fontFamily.primary, fontSize: 16, lineHeight: 25 },
  bodyBold: { fontFamily: fontFamily.primaryBold, fontSize: 16, lineHeight: 25 },
  bodySmall: { fontFamily: fontFamily.primary, fontSize: 14, lineHeight: 21 },
  label: { fontFamily: fontFamily.primaryBold, fontSize: 14, lineHeight: 18 },
  caption: { fontFamily: fontFamily.primary, fontSize: 12, lineHeight: 17 },
  button: { fontFamily: fontFamily.secondaryMedium, fontSize: 16, lineHeight: 20 },
  metric: { fontFamily: fontFamily.secondaryBold, fontSize: 40, lineHeight: 46, fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;
