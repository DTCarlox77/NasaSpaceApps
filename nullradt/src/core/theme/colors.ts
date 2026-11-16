/**
 * Tokens de color semánticos.
 * Modo claro = valores EXACTOS del diseño de Figma (Tailwind @theme: brand, sage, warn, crit, idle, ink, line, night…).
 * Modo oscuro = derivado por el equipo de la misma paleta (Figma no define dark mode).
 */

/** Estado del semáforo: normal / precaución / crítico / no evaluado (sin regla validada). */
export type StatusKey = 'normal' | 'caution' | 'critical' | 'unevaluated';

export interface StatusColors {
  /** Color sólido (punto, barra, ícono). */
  solid: string;
  /** Fondo suave para chips / tarjetas. */
  background: string;
  /** Texto legible sobre `background`. */
  text: string;
  /** Borde/anillo del chip. */
  ring: string;
}

export interface ColorTokens {
  /** Fondo de pantalla (Figma: canvas). */
  background: string;
  surface: string;
  /** Figma: surface-2 (segmentados, cajas informativas). */
  surfaceAlt: string;
  /** Fondo verde suave (Figma: brand-50). */
  surfaceTinted: string;
  /** Fondo salvia suave (Figma: sage-50). */
  surfaceSage: string;
  border: string;
  borderStrong: string;
  divider: string;

  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  primary: string;
  primaryPressed: string;
  /** Verde oscuro para texto/íconos de marca (Figma: brand-ink). */
  primaryText: string;
  /** Verde fuerte para selección/foco (Figma: brand-700). */
  primaryStrong: string;
  /** Fondo de selección suave (Figma: brand-100). */
  primarySoft: string;
  onPrimary: string;

  /** Botón secundario (Figma: sage-100 / sage-700). */
  secondary: string;
  onSecondary: string;
  accent: string;
  accentText: string;
  danger: string;
  /** Rojo fuerte para botones de emergencia / SOS (Figma: crit-600). */
  dangerStrong: string;
  dangerText: string;
  tertiary: string;

  status: Record<StatusKey, StatusColors>;

  /** Superficie oscura (Figma: night) para encabezado y paneles destacados. */
  night: string;
  onNight: string;
  onNightMuted: string;
  nightChip: string;

  tabBar: string;
  tabIconInactive: string;
  overlay: string;
  shadow: string;
  /** Tarjeta destacada (sólida, sin degradado). */
  hero: string;
  onHero: string;
  onHeroMuted: string;
  heroDecoration: string;
  heroChip: string;
  /** Fondos suaves para mosaicos (se rotan en grids). */
  tiles: readonly string[];
  progressTrack: string;
}

export const lightColors: ColorTokens = {
  background: '#F5F8F6',
  surface: '#FFFFFF',
  surfaceAlt: '#F0F4F1',
  surfaceTinted: '#EFFCF4',
  surfaceSage: '#F0F5F2',
  border: '#E2E9E4',
  borderStrong: '#C9D4CD',
  divider: '#E2E9E4',

  text: '#13201A',
  textSecondary: '#3F4E46',
  textMuted: '#5F6E66',
  textInverse: '#FFFFFF',

  primary: '#4ADD82',
  primaryPressed: '#82E6A8',
  primaryText: '#14592F',
  primaryStrong: '#1D8A4B',
  primarySoft: '#D9F7E5',
  onPrimary: '#13201A',

  secondary: '#E0EBE4',
  onSecondary: '#3D5F4A',
  accent: '#DE7C49',
  accentText: '#96451A',
  danger: '#DE5149',
  dangerStrong: '#C2372F',
  dangerText: '#A52A23',
  tertiary: '#5B896C',

  status: {
    normal: { solid: '#4ADD82', background: '#EFFCF4', text: '#14592F', ring: '#B4EFCB' },
    caution: { solid: '#DE7C49', background: '#FDF2EC', text: '#96451A', ring: '#FAE0D1' },
    critical: { solid: '#DE5149', background: '#FDEEED', text: '#A52A23', ring: '#F9D6D3' },
    unevaluated: { solid: '#8A968F', background: '#F2F4F3', text: '#4C5852', ring: '#E2E9E4' },
  },

  night: '#1F1F1F',
  onNight: '#FFFFFF',
  onNightMuted: 'rgba(255, 255, 255, 0.7)',
  nightChip: 'rgba(255, 255, 255, 0.06)',

  tabBar: '#FFFFFF',
  tabIconInactive: '#5F6E66',
  overlay: 'rgba(31, 31, 31, 0.45)',
  shadow: '#13201A',
  hero: '#1F1F1F',
  onHero: '#FFFFFF',
  onHeroMuted: 'rgba(255, 255, 255, 0.7)',
  heroDecoration: 'rgba(74, 221, 130, 0.35)',
  heroChip: 'rgba(255, 255, 255, 0.08)',
  tiles: ['#EFFCF4', '#F0F5F2', '#FDF2EC', '#F2F4F3', '#E0EBE4'],
  progressTrack: '#F0F4F1',
};

export const darkColors: ColorTokens = {
  background: '#101613',
  surface: '#18201C',
  surfaceAlt: '#212B26',
  surfaceTinted: '#163222',
  surfaceSage: '#1C2822',
  border: '#2A3630',
  borderStrong: '#3A4842',
  divider: '#2A3630',

  text: '#EAF3EC',
  textSecondary: '#B9C9BE',
  textMuted: '#8E9E95',
  textInverse: '#13201A',

  primary: '#4ADD82',
  primaryPressed: '#82E6A8',
  primaryText: '#82E6A8',
  primaryStrong: '#4ADD82',
  primarySoft: '#1E4630',
  onPrimary: '#13201A',

  secondary: '#2A3B31',
  onSecondary: '#B9D0C1',
  accent: '#DE7C49',
  accentText: '#EBA57F',
  danger: '#DE5149',
  dangerStrong: '#C2372F',
  dangerText: '#EA8780',
  tertiary: '#8EB29B',

  status: {
    normal: { solid: '#4ADD82', background: 'rgba(74, 221, 130, 0.14)', text: '#82E6A8', ring: 'rgba(74, 221, 130, 0.35)' },
    caution: { solid: '#DE7C49', background: 'rgba(222, 124, 73, 0.16)', text: '#EBA57F', ring: 'rgba(222, 124, 73, 0.4)' },
    critical: { solid: '#DE5149', background: 'rgba(222, 81, 73, 0.16)', text: '#EA8780', ring: 'rgba(222, 81, 73, 0.4)' },
    unevaluated: { solid: '#8A968F', background: 'rgba(138, 150, 143, 0.16)', text: '#B9C4BE', ring: 'rgba(138, 150, 143, 0.35)' },
  },

  night: '#0B0F0D',
  onNight: '#EAF3EC',
  onNightMuted: 'rgba(234, 243, 236, 0.7)',
  nightChip: 'rgba(234, 243, 236, 0.08)',

  tabBar: '#18201C',
  tabIconInactive: '#8E9E95',
  overlay: 'rgba(0, 0, 0, 0.6)',
  shadow: '#000000',
  hero: '#0B0F0D',
  onHero: '#EAF3EC',
  onHeroMuted: 'rgba(234, 243, 236, 0.75)',
  heroDecoration: 'rgba(74, 221, 130, 0.3)',
  heroChip: 'rgba(234, 243, 236, 0.1)',
  tiles: ['#163222', '#1C2822', '#33251E', '#232A26', '#22352A'],
  progressTrack: '#212B26',
};
