import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, {
  Easing,
  FadeIn,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import type { IndicatorId } from '@/domain/entities/HealthIndicator';
import { DEVICE, isMeasurable, simulateMeasurement, type MeasurableId, type SimulatedReading } from '@/domain/usecases/SimulateMeasurement';
import { AppText, Button, Card, IconButton, StatusBadge } from '@/presentation/components/ui';
import { Disclaimer } from '@/presentation/components/feedback/Disclaimer';
import { alertCrew } from '@/presentation/features/crew/crewAlerts';
import { useAuthStore } from '@/presentation/store/authStore';
import { useHealthLogStore } from '@/presentation/store/healthLogStore';

type Phase = 'searching' | 'connected' | 'measuring' | 'result';

const ACircle = Animated.createAnimatedComponent(Circle);
const RING = 180;
const STROKE = 12;
const R = (RING - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const MEASURE_MS = 6000;

/** Valores "en vivo" que muestra el equipo mientras mide (solo visual). */
function liveValue(id: MeasurableId, p: number): string {
  switch (id) {
    case 'bloodPressure': {
      // Manguito: infla hasta ~170 mmHg y desinfla.
      const cuff = p < 0.35 ? (p / 0.35) * 170 : 170 - ((p - 0.35) / 0.65) * 120;
      return String(Math.round(cuff));
    }
    case 'heartRate':
      return String(Math.round(60 + Math.random() * 25));
    case 'spo2':
      return String(Math.round(94 + Math.random() * 5));
    case 'bodyTemperature':
      return (34.5 + p * 2.3).toFixed(1);
    case 'respRate':
      return String(Math.round(12 + Math.random() * 6));
  }
}

export default function MeasureScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const params = useLocalSearchParams<{ indicator?: string }>();
  const id: MeasurableId = params.indicator && isMeasurable(params.indicator as IndicatorId) ? (params.indicator as MeasurableId) : 'bloodPressure';
  const device = DEVICE[id];
  const userId = useAuthStore((s) => s.session?.userId ?? '');
  const addReading = useHealthLogStore((s) => s.addReading);

  const [phase, setPhase] = useState<Phase>('searching');
  const [live, setLive] = useState('—');
  const [result, setResult] = useState<SimulatedReading | null>(null);
  const [alerted, setAlerted] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const progress = useSharedValue(0);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  // 1) Buscar el equipo (simulado) → conectado.
  const scheduleConnect = () =>
    timers.current.push(
      setTimeout(() => {
        setPhase('connected');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }, 2600),
    );
  useEffect(() => {
    scheduleConnect();
  }, []);

  // 2) Medir: anillo de progreso + valores en vivo → resultado aleatorio.
  const measure = () => {
    clearTimers();
    setAlerted(false);
    setPhase('measuring');
    progress.value = 0;
    progress.value = withTiming(1, { duration: MEASURE_MS, easing: Easing.inOut(Easing.quad) });
    let elapsed = 0;
    const tick = () => {
      elapsed += 120;
      const p = Math.min(elapsed / MEASURE_MS, 1);
      setLive(liveValue(id, p));
      if (p < 1) timers.current.push(setTimeout(tick, 120));
      else finish();
    };
    tick();
  };

  const finish = () => {
    const r = simulateMeasurement(id);
    const takenAt = new Date().toISOString();
    addReading(userId, {
      indicatorId: id,
      status: r.status,
      reading: { value: r.value, secondaryValue: r.secondaryValue, takenAt, source: 'wearable', synced: false },
    });
    setResult(r);
    setPhase('result');
    if (r.status === 'critical') {
      // Valor grave: se avisa automáticamente al resto de la tripulación.
      alertCrew({ kind: 'measurement', severity: 'critical', indicatorId: id, value: `${fmt(r)} ${t(`measure.units.${id}`)}` });
      setAlerted(true);
    } else {
      Haptics.notificationAsync(
        r.status === 'normal' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
      ).catch(() => {});
    }
  };

  const fmt = (r: SimulatedReading) => (r.secondaryValue !== undefined ? `${r.value}/${r.secondaryValue}` : String(r.value));
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: CIRC * (1 - progress.value) }));
  const close = () => (router.canGoBack() ? router.back() : router.replace('/body'));

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={[styles.row, { gap: spacing.md, padding: spacing.lg }]}>
        <IconButton icon="arrow-back" tone="filled" accessibilityLabel={t('common.back')} onPress={close} />
        <View style={styles.flex}>
          <AppText variant="h2">{t(`measure.title.${id}`)}</AppText>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, gap: spacing.xl }}>
        {/* Equipo */}
        <Card style={[styles.row, { gap: spacing.md }]}>
          <View style={[styles.deviceIcon, { backgroundColor: colors.surfaceTinted, borderRadius: radius.md }]}>
            <Ionicons name={DEVICE_ICON[device]} size={26} color={colors.primaryText} />
          </View>
          <View style={styles.flex}>
            <AppText variant="title">{t(`measure.devices.${device}`)}</AppText>
            <AppText variant="bodySmall" color={phase === 'searching' ? 'textMuted' : 'primaryText'}>
              {phase === 'searching' ? t('measure.searching') : t('measure.connected')}
            </AppText>
          </View>
          {phase !== 'searching' && (
            <View style={[styles.row, { gap: 4 }]}>
              <Ionicons name="bluetooth" size={16} color={colors.primaryText} />
              <Ionicons name="battery-half" size={18} color={colors.textMuted} />
            </View>
          )}
        </Card>

        {/* Escena principal */}
        <View style={[styles.center, { minHeight: 260 }]}>
          {phase === 'searching' && <Radar color={colors.primary} />}

          {phase === 'connected' && (
            <Animated.View entering={FadeIn.duration(250)} style={[styles.center, { gap: spacing.lg }]}>
              <View style={[styles.okCircle, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name="link" size={48} color={colors.primaryText} />
              </View>
              <AppText variant="h3" align="center">{t('measure.readyTitle')}</AppText>
              <AppText color="textSecondary" align="center">{t(`measure.instructions.${id}`)}</AppText>
            </Animated.View>
          )}

          {phase === 'measuring' && (
            <Animated.View entering={FadeIn.duration(200)} style={[styles.center, { gap: spacing.md }]}>
              <View style={{ width: RING, height: RING }}>
                <Svg width={RING} height={RING}>
                  <Circle cx={RING / 2} cy={RING / 2} r={R} stroke={colors.progressTrack} strokeWidth={STROKE} fill="none" />
                  <ACircle
                    cx={RING / 2}
                    cy={RING / 2}
                    r={R}
                    stroke={colors.primary}
                    strokeWidth={STROKE}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={[CIRC, CIRC]}
                    rotation={-90}
                    origin={`${RING / 2}, ${RING / 2}`}
                    animatedProps={ringProps}
                  />
                </Svg>
                <View style={[StyleSheet.absoluteFill, styles.center]}>
                  <AppText variant="display" style={{ fontSize: 44, lineHeight: 50, fontVariant: ['tabular-nums'] }}>{live}</AppText>
                  <AppText color="textMuted">{t(`measure.units.${id}`)}</AppText>
                </View>
              </View>
              <PulseDots color={colors.primary} />
              <AppText variant="title">{t('measure.measuring')}</AppText>
              <AppText variant="caption" color="textMuted" align="center">{t('measure.keepStill')}</AppText>
            </Animated.View>
          )}

          {phase === 'result' && result && (
            <Animated.View entering={FadeIn.duration(250)} style={{ alignSelf: 'stretch', gap: spacing.lg }}>
              <Card style={[styles.center, { gap: spacing.md, paddingVertical: spacing.xxl, backgroundColor: colors.status[result.status].background, borderColor: colors.status[result.status].ring, borderWidth: 1 }]}>
                <StatusBadge status={result.status} size="lg" />
                <View style={[styles.row, { gap: 6, alignItems: 'baseline' }]}>
                  <AppText variant="display" style={{ fontSize: 52, lineHeight: 60, fontVariant: ['tabular-nums'] }}>{fmt(result)}</AppText>
                  <AppText color="textMuted">{t(`measure.units.${id}`)}</AppText>
                </View>
                <AppText align="center" style={{ color: colors.status[result.status].text }}>{t(`measure.result.${result.status}`)}</AppText>
              </Card>

              {alerted && (
                <Card tone="night" style={[styles.row, { gap: spacing.md }]}>
                  <Ionicons name="people" size={24} color={colors.primary} />
                  <View style={styles.flex}>
                    <AppText variant="title" style={{ color: colors.onNight }}>{t('crew.alertSentTitle')}</AppText>
                    <AppText variant="bodySmall" style={{ color: colors.onNightMuted }}>{t('measure.crewNotified')}</AppText>
                  </View>
                </Card>
              )}

              <AppText variant="caption" color="textMuted">
                {t('measure.rule', { source: result.source.title })}
              </AppText>
            </Animated.View>
          )}
        </View>

        {/* Acciones */}
        {phase === 'connected' && <Button label={t('measure.start')} leftIcon="play" size="lg" fullWidth onPress={measure} />}
        {phase === 'measuring' && (
          <Button
            label={t('measure.stop')}
            variant="outline"
            fullWidth
            onPress={() => {
              clearTimers();
              cancelAnimation(progress);
              setPhase('connected');
            }}
          />
        )}
        {phase === 'result' && (
          <View style={{ gap: spacing.sm }}>
            {result?.status !== 'normal' && (
              <Button label={t('measure.openAlert')} variant="danger" leftIcon="megaphone" fullWidth onPress={() => router.push({ pathname: '/alert', params: { trigger: 'manual' } })} />
            )}
            <Button label={t('measure.done')} leftIcon="checkmark" size="lg" fullWidth onPress={close} />
            <Button label={t('measure.again')} variant="ghost" leftIcon="refresh" fullWidth onPress={measure} />
          </View>
        )}
        {phase === 'searching' && <Button label={t('alert.cancel')} variant="ghost" fullWidth onPress={close} />}

        <Disclaimer />
      </ScrollView>
    </SafeAreaView>
  );
}

const DEVICE_ICON: Record<(typeof DEVICE)[MeasurableId], keyof typeof Ionicons.glyphMap> = {
  bpCuff: 'speedometer-outline',
  pulseOximeter: 'finger-print-outline',
  thermometer: 'thermometer-outline',
  respBand: 'body-outline',
};

/** Radar de búsqueda: ondas que se expanden (lineal, sin rebote). */
function Radar({ color }: { color: string }) {
  return (
    <View style={[styles.radar, styles.center]}>
      {[0, 1, 2].map((i) => (
        <RadarRing key={i} delay={i * 700} color={color} />
      ))}
      <View style={[styles.radarCore, { backgroundColor: color }]}>
        <Ionicons name="bluetooth" size={36} color="#13201A" />
      </View>
    </View>
  );
}

function RadarRing({ delay, color }: { delay: number; color: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2100, easing: Easing.out(Easing.quad) }), -1, false));
    return () => cancelAnimation(p);
  }, [delay, p]);
  const style = useAnimatedStyle(() => ({ opacity: 0.5 * (1 - p.value), transform: [{ scale: 0.4 + p.value * 1.6 }] }));
  return <Animated.View style={[styles.radarRing, { borderColor: color }, style]} />;
}

function PulseDots({ color }: { color: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(p);
  }, [p]);
  return (
    <View style={[styles.row, { gap: 8 }]}>
      {[0, 1, 2].map((i) => (
        <Dot key={i} p={p} i={i} color={color} />
      ))}
    </View>
  );
}

function Dot({ p, i, color }: { p: SharedValue<number>; i: number; color: string }) {
  const style = useAnimatedStyle(() => {
    const phase = (p.value + i / 3) % 1;
    return { opacity: 0.25 + 0.75 * (phase < 0.5 ? phase * 2 : (1 - phase) * 2) };
  });
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  deviceIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  okCircle: { width: 104, height: 104, borderRadius: 52, alignItems: 'center', justifyContent: 'center' },
  radar: { width: 240, height: 240 },
  radarRing: { position: 'absolute', width: 200, height: 200, borderRadius: 100, borderWidth: 2 },
  radarCore: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
