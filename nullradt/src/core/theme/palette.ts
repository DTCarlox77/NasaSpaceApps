/**
 * Paleta base del proyecto (valores crudos).
 * Colores de marca definidos por el equipo:
 *   #4ADD82 (green)  #6BDE49 (lime)  #DE7C49 (orange)  #DE5149 (red)  #5B896C (sage)
 * Las escalas 50–900 son tonos derivados para fondos, bordes y texto accesible.
 * NO uses este archivo directamente en componentes: usa los tokens semánticos de `colors.ts`.
 */
export const palette = {
  green: {
    50: '#EDFCF3',
    100: '#D3F8E2',
    200: '#A5F0C4',
    300: '#74E6A2',
    400: '#4ADD82', // marca
    500: '#2FC468',
    600: '#23A054',
    700: '#1E7D44',
    800: '#1B6339',
    900: '#174F2F',
  },
  lime: {
    50: '#F1FCEC',
    100: '#DDF8D2',
    300: '#9BE97F',
    400: '#6BDE49', // marca
    600: '#45B225',
    700: '#368A1D',
  },
  orange: {
    50: '#FDF3EC',
    100: '#FAE1D1',
    300: '#EBA57F',
    400: '#DE7C49', // marca
    600: '#B85A2A',
    700: '#934622',
  },
  red: {
    50: '#FDEEED',
    100: '#F9D4D2',
    300: '#EA8780',
    400: '#DE5149', // marca
    600: '#B9332B',
    700: '#932822',
  },
  sage: {
    50: '#F0F5F2',
    100: '#DCE8E0',
    200: '#B9D0C1',
    300: '#8EB29B',
    400: '#5B896C', // marca
    600: '#466B53',
    700: '#3A5745',
    800: '#2D4436',
    900: '#1F3027',
  },
  /** Neutros con matiz verde para que el gris no se vea "frío" junto a la marca. */
  neutral: {
    0: '#FFFFFF',
    25: '#F6FAF7',
    50: '#EEF4F0',
    100: '#E1EAE4',
    200: '#C7D4CB',
    400: '#8A9A90',
    500: '#66766C',
    600: '#4A5A50',
    700: '#33423A',
    750: '#2D3D34',
    800: '#22302A',
    850: '#1B2721',
    900: '#121C16',
    950: '#0C140F',
  },
  cream: '#FBF7F1',
  black: '#000000',
  white: '#FFFFFF',
} as const;
