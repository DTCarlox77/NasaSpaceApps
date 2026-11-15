import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import Svg, { Rect } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppText, Button, Card, PressableScale } from '@/presentation/components/ui';
import { TestScaffold, type TestRunProps } from '@/presentation/features/tests/TestScaffold';

/** Tamaños (dp) de la "E" por nivel. Orientativo: no está calibrado como una cartilla clínica. */
const SIZES = [96, 72, 54, 40, 30, 22, 16, 12, 9, 7];
type Dir = 0 | 90 | 180 | 270; // 0 = patas hacia la derecha
const DIRS: { dir: Dir; icon: keyof typeof Ionicons.glyphMap }[] = [
  { dir: 270, icon: 'arrow-up' },
  { dir: 0, icon: 'arrow-forward' },
  { dir: 90, icon: 'arrow-down' },
  { dir: 180, icon: 'arrow-back' },
];
const randomDir = (): Dir => ([0, 90, 180, 270] as Dir[])[Math.floor(Math.random() * 4)]!;

/** "E" de Snellen dibujada en una rejilla 5×5 (proporción estándar del optotipo). */
function TumblingE({ size, dir, color }: { size: number; dir: Dir; color: string }) {
  const u = size / 5;
  return (
    <View style={{ width: size, height: size, transform: [{ rotate: `${dir}deg` }] }}>
      <Svg width={size} height={size}>
        <Rect x={0} y={0} width={u} height={size} fill={color} />
        <Rect x={0} y={0} width={size} height={u} fill={color} />
        <Rect x={0} y={2 * u} width={size} height={u} fill={color} />
        <Rect x={0} y={4 * u} width={size} height={u} fill={color} />
      </Svg>
    </View>
  );
}

type Eye = 'right' | 'left';

function VisionRun({ onComplete }: TestRunProps) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const [eye, setEye] = useState<Eye>('right');
  const [covering, setCovering] = useState(true);
  const [level, setLevel] = useState(0);
  const [misses, setMisses] = useState(0);
  const [dir, setDir] = useState<Dir>(randomDir);
  const [scores, setScores] = useState<Partial<Record<Eye, number>>>({});

  const endEye = (passed: number) => {
    const next = { ...scores, [eye]: passed };
    setScores(next);
    if (eye === 'right') {
      setEye('left');
      setCovering(true);
      setLevel(0);
      setMisses(0);
      setDir(randomDir());
    } else {
      const right = next.right ?? 0;
      const left = next.left ?? 0;
      onComplete({ score: Math.round(((right + left) / 2) * 10) / 10, details: { right, left } });
    }
  };

  const answer = (d: Dir) => {
    if (d === dir) {
      Haptics.selectionAsync().catch(() => {});
      if (level + 1 >= SIZES.length) return endEye(SIZES.length);
      setLevel(level + 1);
      setMisses(0);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      // Dos fallos en el mismo tamaño terminan la prueba de este ojo.
      if (misses + 1 >= 2) return endEye(level);
      setMisses(misses + 1);
    }
    setDir(randomDir());
  };

  if (covering) {
    return (
      <View style={[styles.flex, styles.center, { gap: spacing.lg }]}>
        <Ionicons name={eye === 'right' ? 'eye-off-outline' : 'eye-outline'} size={72} color={colors.primaryText} />
        <AppText variant="h2" align="center">{t(eye === 'right' ? 'tests.vision.coverLeft' : 'tests.vision.coverRight')}</AppText>
        <AppText color="textSecondary" align="center">{t('tests.vision.distance')}</AppText>
        <Button label={t('tests.vision.ready')} leftIcon="play" size="lg" fullWidth onPress={() => setCovering(false)} />
      </View>
    );
  }

  return (
    <View style={[styles.flex, { gap: spacing.lg }]}>
      <Card tone="alt" style={[styles.row, { justifyContent: 'space-between' }]}>
        <AppText variant="label">{t(`tests.vision.eye.${eye}`)}</AppText>
        <AppText variant="label" color="textMuted">{t('tests.vision.level', { n: level + 1, total: SIZES.length })}</AppText>
      </Card>
      <View style={[styles.flex, styles.center, { backgroundColor: '#FFFFFF', borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border }]}>
        <TumblingE size={SIZES[level]!} dir={dir} color="#000000" />
      </View>
      <AppText align="center" color="textSecondary">{t('tests.vision.question')}</AppText>
      <View style={[styles.row, { gap: spacing.md, justifyContent: 'center' }]}>
        {DIRS.map((d) => (
          <PressableScale
            key={d.dir}
            accessibilityLabel={t(`tests.vision.dir.${d.dir}`)}
            onPress={() => answer(d.dir)}
            style={[styles.arrow, { borderRadius: radius.button, backgroundColor: colors.night }]}
          >
            <Ionicons name={d.icon} size={30} color={colors.onNight} />
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

export default function VisionTest() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  return (
    <TestScaffold
      id="vision"
      Run={(p) => <VisionRun {...p} />}
      format={(s) => `${s}/10`}
      extra={(r) => {
        const diff = Math.abs((r.details.right ?? 0) - (r.details.left ?? 0));
        return (
          <Card style={{ gap: spacing.md }}>
            <View style={[styles.row, { gap: spacing.md }]}>
              {(['right', 'left'] as const).map((e) => (
                <View key={e} style={styles.flex}>
                  <AppText variant="h3">{r.details[e]}/10</AppText>
                  <AppText variant="caption" color="textMuted">{t(`tests.vision.eye.${e}`)}</AppText>
                </View>
              ))}
            </View>
            {diff >= 2 && (
              <View style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.status.caution.background }}>
                <AppText variant="bodySmall" style={{ color: colors.status.caution.text }}>{t('tests.vision.asymmetry')}</AppText>
                <Button label={t('wellbeing.goMonitor')} variant="secondary" size="sm" onPress={() => router.navigate('/body')} />
              </View>
            )}
          </Card>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  arrow: { width: 68, height: 68, alignItems: 'center', justifyContent: 'center' },
});
