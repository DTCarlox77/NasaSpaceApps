/** Escala de espaciado (múltiplos de 4). */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

/** Radios del Figma: xl .75rem (inputs), 2xl 1rem (botones/filas), card 1.25rem, 3xl 1.5rem, hero 1.75rem. */
export const radius = {
  sm: 8,
  md: 12,
  button: 16,
  lg: 20,
  sheet: 24,
  xl: 28,
  pill: 999,
} as const;

/** Tamaño mínimo de toque recomendado (accesibilidad, guantes, microgravedad). */
export const hitSize = 48;

/** Tiempos y resortes compartidos para que todas las animaciones se sientan iguales. */
export const motion = {
  duration: { fast: 150, normal: 250, slow: 400, pulse: 1200 },
  spring: {
    press: { damping: 18, stiffness: 320, mass: 0.6 },
    gentle: { damping: 20, stiffness: 180 },
    bouncy: { damping: 12, stiffness: 200 },
  },
  /** Retraso entre elementos en listas con entrada escalonada. */
  stagger: 70,
  pressedScale: 0.97,
} as const;
