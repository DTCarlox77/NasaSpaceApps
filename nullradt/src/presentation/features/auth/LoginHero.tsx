import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppText } from '@/presentation/components/ui';
import { BrandLogo } from '@/presentation/components/brand/BrandMark';

const STARS = [
  [8, 18],
  [26, 52],
  [44, 10],
  [58, 38],
  [70, 14],
  [86, 30],
  [94, 8],
];

/** Hoja del login que se superpone al panel (debe coincidir con el `marginTop` negativo de la hoja). */
export const LOGIN_SHEET_OVERLAP = 24;
const PLANET_R = 120;

/**
 * Panel oscuro del login: logo arriba, título abajo, y un planeta plano que "asoma"
 * desde la esquina inferior derecha, justo donde empieza la hoja gris.
 */
export function LoginHero() {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();

  return (
    <View style={[styles.hero, { backgroundColor: colors.night, paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: LOGIN_SHEET_OVERLAP + spacing.xl }]}>
      {/* Estrellas (en % para no deformarse) */}
      <Svg width="100%" height="100%" viewBox="0 0 100 60" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
        {STARS.map(([x, y]) => (
          <Circle key={`${x}-${y}`} cx={x} cy={y} r={0.35} fill="#FFFFFF" opacity={0.5} />
        ))}
      </Svg>

      {/* Planeta + órbita, anclados a la esquina: el centro queda en el borde de la hoja gris */}
      <Svg width={PLANET_R * 2 + 140} height={PLANET_R + 40} style={[styles.planet, { right: -PLANET_R, bottom: LOGIN_SHEET_OVERLAP }]}>
        <Ellipse cx={PLANET_R + 140} cy={PLANET_R + 40} rx={PLANET_R + 120} ry={52} stroke="#4ADD82" strokeOpacity={0.45} strokeWidth={1.5} fill="none" />
        <Circle cx={PLANET_R + 140} cy={PLANET_R + 40} r={PLANET_R} fill="#5B896C" opacity={0.28} />
        <Circle cx={PLANET_R + 140} cy={PLANET_R + 40} r={PLANET_R * 0.66} fill="#4ADD82" opacity={0.12} />
        <Circle cx={36} cy={PLANET_R + 40 - 30} r={9} stroke="#6BDE49" strokeOpacity={0.45} fill="none" />
        <Circle cx={36} cy={PLANET_R + 40 - 30} r={3.5} fill="#6BDE49" />
      </Svg>

      <BrandLogo size={40} />
      <AppText variant="h1" style={{ color: colors.onNight, fontSize: 32, lineHeight: 38, marginTop: spacing.xxxl }}>{t('auth.hero.title')}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { overflow: 'hidden', minHeight: 230, justifyContent: 'space-between' },
  planet: { position: 'absolute' },
});
