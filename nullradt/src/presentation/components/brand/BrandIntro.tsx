import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { MARK, MARK_COLORS, BrandWordmark } from './BrandMark';

const APath = Animated.createAnimatedComponent(Path);
const ACircle = Animated.createAnimatedComponent(Circle);
const ARect = Animated.createAnimatedComponent(Rect);

const TOTAL = 1900; // ms de la animación del símbolo y el nombre
const HOLD = 350;
const FADE = 380;
const { green, white, bg } = MARK_COLORS;
const CIRC = 2 * Math.PI * MARK.circle.r;

/** Fracción de la línea de tiempo [0..1] → progreso local [0..1] de un tramo. */
function seg(t: number, from: number, to: number) {
  'worklet';
  return interpolate(t, [from, to], [0, 1], 'clamp');
}

/** Trazo que se "dibuja" con strokeDashoffset en el tramo [from, to]. */
function DrawPath({ t, d, length, from, to, ...rest }: { t: SharedValue<number>; d: string; length: number; from: number; to: number } & Omit<React.ComponentProps<typeof Path>, 'd'>) {
  const props = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - seg(t.value, from, to)) }));
  return <APath d={d} strokeDasharray={[length, length]} animatedProps={props} {...rest} />;
}

/**
 * Intro de marca al abrir la app: el símbolo se traza (anillo → barra nula → torre → aspas),
 * emite una onda tipo radiación y aparece "NullRadt". Plano, sin rebotes. Respeta "reducir movimiento".
 */
export function BrandIntro({ onDone }: { onDone: () => void }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  const out = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      out.value = withDelay(500, withTiming(0, { duration: 250 }, (ok) => ok && runOnJS(onDone)()));
      t.value = 1;
      return;
    }
    t.value = withTiming(1, { duration: TOTAL, easing: Easing.inOut(Easing.cubic) });
    out.value = withDelay(TOTAL + HOLD, withTiming(0, { duration: FADE, easing: Easing.out(Easing.quad) }, (ok) => ok && runOnJS(onDone)()));
  }, [reduced, t, out, onDone]);

  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: CIRC * (1 - seg(t.value, 0, 0.32)) }));
  const baseProps = useAnimatedProps(() => ({ width: MARK.base.width * seg(t.value, 0.42, 0.62), x: MARK.base.x + (MARK.base.width / 2) * (1 - seg(t.value, 0.42, 0.62)) }));
  const waveProps = useAnimatedProps(() => {
    const p = seg(t.value, 0.55, 1);
    return { r: MARK.circle.r + p * 90, strokeOpacity: p > 0 ? 0.45 * (1 - p) : 0 };
  });
  const bladesStyle = useAnimatedStyle(() => ({ opacity: seg(t.value, 0.5, 0.8) }));
  const wordStyle = useAnimatedStyle(() => {
    const p = seg(t.value, 0.66, 1);
    return { opacity: p, transform: [{ translateY: 10 * (1 - p) }] };
  });
  const rootStyle = useAnimatedStyle(() => ({ opacity: out.value }));

  const { cx, cy, r, width } = MARK.circle;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, rootStyle]} pointerEvents="none" accessibilityLabel="NullRadt">
      <View style={styles.mark}>
        <Svg width={180} height={180} viewBox="-40 -40 324 324">
          {/* Onda de "radiación" que se expande desde el anillo */}
          <ACircle cx={cx} cy={cy} fill="none" stroke={green} strokeWidth={2} animatedProps={waveProps} />
          <G fill="none" stroke={green} strokeLinejoin="round">
            <ACircle
              cx={cx}
              cy={cy}
              r={r}
              strokeWidth={width}
              strokeDasharray={[CIRC, CIRC]}
              rotation={-90}
              origin={`${cx}, ${cy}`}
              animatedProps={ringProps}
            />
            <DrawPath t={t} d={MARK.slash} length={87} from={0.2} to={0.38} strokeWidth={MARK.slashWidth} />
            {MARK.legs.map((d) => (
              <DrawPath key={d} t={t} d={d} length={67} from={0.3} to={0.5} strokeWidth={MARK.legWidth} strokeLinecap="round" />
            ))}
          </G>
          <ARect y={MARK.base.y} height={MARK.base.height} fill={green} animatedProps={baseProps} />
          <G fill="none" stroke={white} strokeLinecap="round" strokeLinejoin="round">
            <DrawPath t={t} d={MARK.chevron} length={125} from={0.45} to={0.66} strokeWidth={MARK.chevronWidth} />
          </G>
        </Svg>
        {/* Aspas: aparecen juntas (no se trazan) para no recargar la animación */}
        <Animated.View style={[StyleSheet.absoluteFill, bladesStyle]}>
          <Svg width={180} height={180} viewBox="-40 -40 324 324">
            <G fill="none" stroke={green} strokeLinejoin="round">
              {MARK.blades.map((d) => (
                <Path key={d} d={d} strokeWidth={MARK.bladeWidth} />
              ))}
            </G>
            <G fill="none" stroke={white} strokeLinecap="round">
              {MARK.bladeInner.map((d) => (
                <Path key={d} d={d} strokeWidth={MARK.bladeInnerWidth} />
              ))}
            </G>
          </Svg>
        </Animated.View>
      </View>
      <Animated.View style={wordStyle}>
        <BrandWordmark size={34} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: bg, alignItems: 'center', justifyContent: 'center', gap: 8, zIndex: 100 },
  mark: { width: 180, height: 180 },
});
