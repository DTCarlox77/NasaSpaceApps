import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { useAppTheme } from '@/core/theme';
import { AppText } from '../ui/AppText';

/**
 * Isotipo de NullRadt en vectores (redibujado a partir del PNG del Figma): nítido a cualquier tamaño.
 * Lienzo 244×244. Las mismas piezas se animan en la intro (`BrandIntro`).
 */
export const MARK_COLORS = { green: '#6BDE49', white: '#FFFFFF', bg: '#1F1F1F' } as const;

export const MARK = {
  size: 244,
  /** Recorte sin margen (para usar el isotipo sobre cualquier fondo). */
  tightViewBox: '34 14 182 214',
  circle: { cx: 124, cy: 113, r: 37.5, width: 15 },
  blades: [
    'M43.59 62.13A96 96 0 0 1 85.95 25.3L103.85 65.5A52 52 0 0 0 80.9 85.44Z',
    'M206.41 62.13A96 96 0 0 0 164.05 25.3L146.15 65.5A52 52 0 0 1 169.1 85.44Z',
  ],
  bladeWidth: 9,
  bladeInner: ['M61.17 63.13A81 81 0 0 1 79.71 45.85', 'M188.83 63.13A81 81 0 0 0 170.29 45.85'],
  bladeInnerWidth: 5,
  slash: 'M148 77L100 149',
  slashWidth: 13,
  legs: ['M97 150L64 208', 'M151 150L184 208'],
  legWidth: 10,
  chevron: 'M84 205L104 169L145 169L161 205',
  chevronWidth: 9,
  base: { x: 45, y: 210, width: 156, height: 12 },
} as const;

/** Isotipo. `framed` dibuja el cuadro oscuro de la marca; sin él, solo el símbolo (fondo transparente). */
export function BrandMark({ size = 40, framed = true }: { size?: number; framed?: boolean }) {
  const { green, white, bg } = MARK_COLORS;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={framed ? `0 0 ${MARK.size} ${MARK.size}` : MARK.tightViewBox}
      accessible={false}
    >
      {framed && <Rect width={MARK.size} height={MARK.size} rx={MARK.size * 0.22} fill={bg} />}
      <G fill="none" stroke={green} strokeLinejoin="round">
        {MARK.blades.map((d) => (
          <Path key={d} d={d} strokeWidth={MARK.bladeWidth} />
        ))}
        <Circle cx={MARK.circle.cx} cy={MARK.circle.cy} r={MARK.circle.r} strokeWidth={MARK.circle.width} />
        <Path d={MARK.slash} strokeWidth={MARK.slashWidth} />
        {MARK.legs.map((d) => (
          <Path key={d} d={d} strokeWidth={MARK.legWidth} strokeLinecap="round" />
        ))}
      </G>
      <Rect {...MARK.base} fill={green} />
      <G fill="none" stroke={white} strokeLinecap="round" strokeLinejoin="round">
        <Path d={MARK.chevron} strokeWidth={MARK.chevronWidth} />
        {MARK.bladeInner.map((d) => (
          <Path key={d} d={d} strokeWidth={MARK.bladeInnerWidth} />
        ))}
      </G>
    </Svg>
  );
}

/** Isotipo + nombre. El logo del Figma dice "NullRads" (error); el nombre correcto es NullRadt. */
export function BrandLogo({ size = 44 }: { size?: number }) {
  const { spacing } = useAppTheme();
  return (
    <View accessibilityRole="header" accessibilityLabel="NullRadt" style={[styles.row, { gap: spacing.sm }]}>
      <BrandMark size={size} />
      <BrandWordmark size={size * 0.7} />
    </View>
  );
}

/** Nombre de la marca: "Null" claro + "Radt" verde. */
export function BrandWordmark({ size = 30 }: { size?: number }) {
  const { colors } = useAppTheme();
  return (
    <AppText variant="h1" style={{ color: colors.onNight, fontSize: size, lineHeight: size * 1.2 }}>
      Null<AppText variant="h1" style={{ color: colors.primary, fontSize: size, lineHeight: size * 1.2 }}>Radt</AppText>
    </AppText>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center' } });
