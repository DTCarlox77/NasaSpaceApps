import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { palette, useAppTheme } from '@/core/theme';
import { AppText, Card } from '@/presentation/components/ui';
import { TestScaffold, type TestRunProps } from '@/presentation/features/tests/TestScaffold';
import { useAuthStore } from '@/presentation/store/authStore';
import { useHealthLogStore } from '@/presentation/store/healthLogStore';
import { resultsOf, useTestsStore } from '@/presentation/store/testsStore';

const TRIALS = 6;
type State = 'wait' | 'go' | 'early' | 'hit';

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

/** Reflejos de alerta (estilo PVT): toca en cuanto el círculo se ponga verde. */
function ReactionRun({ onComplete }: TestRunProps) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const [state, setState] = useState<State>('wait');
  const [times, setTimes] = useState<number[]>([]);
  const [last, setLast] = useState<number | null>(null);
  const falseStarts = useRef(0);
  const [falseCount, setFalseCount] = useState(0);
  const goAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      goAt.current = performance.now();
      setState('go');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }, 1500 + Math.random() * 2500);
  };

  useEffect(() => {
    arm();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onPress = () => {
    if (state === 'wait') {
      // Toque antes de tiempo: se cuenta y se reinicia el intento.
      falseStarts.current++;
      setFalseCount(falseStarts.current);
      setState('early');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setState('wait');
        arm();
      }, 1100);
      return;
    }
    if (state !== 'go') return;
    const ms = Math.round(performance.now() - goAt.current);
    const next = [...times, ms];
    setTimes(next);
    setLast(ms);
    setState('hit');
    if (next.length >= TRIALS) {
      timer.current = setTimeout(
        () => onComplete({ score: median(next), details: { best: Math.min(...next), falseStarts: falseStarts.current, trials: next.length } }),
        700,
      );
      return;
    }
    timer.current = setTimeout(() => {
      setState('wait');
      arm();
    }, 800);
  };

  const bg = state === 'go' ? colors.primary : state === 'early' ? palette.orange[600] : colors.night;
  const label =
    state === 'go' ? t('tests.reaction.now') : state === 'early' ? t('tests.reaction.early') : state === 'hit' ? `${last} ms` : t('tests.reaction.wait');

  return (
    <View style={[styles.flex, { gap: spacing.md }]}>
      <View style={[styles.row, { gap: spacing.sm }]}>
        {Array.from({ length: TRIALS }).map((_, i) => (
          <View key={i} style={[styles.flex, { height: 6, borderRadius: 3, backgroundColor: i < times.length ? colors.primary : colors.progressTrack }]} />
        ))}
      </View>
      <Pressable
        onPressIn={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.flex, styles.center, { backgroundColor: bg, borderRadius: radius.xl, gap: spacing.md }]}
      >
        <Ionicons name={state === 'go' ? 'flash' : state === 'early' ? 'hand-left-outline' : state === 'hit' ? 'checkmark' : 'hourglass-outline'} size={64} color={state === 'go' ? '#13201A' : '#FFFFFF'} />
        <AppText variant="display" style={{ color: state === 'go' ? '#13201A' : '#FFFFFF', fontSize: 36, lineHeight: 44 }}>{label}</AppText>
      </Pressable>
      <Card tone="alt" style={[styles.row, { justifyContent: 'space-between' }]}>
        <AppText variant="label">{t('tests.reaction.trial', { n: Math.min(times.length + 1, TRIALS), total: TRIALS })}</AppText>
        <AppText variant="label" color="accentText">{t('tests.reaction.falseStarts', { count: falseCount })}</AppText>
      </Card>
    </View>
  );
}

export default function ReactionTest() {
  const { t } = useTranslation();
  const { spacing } = useAppTheme();
  const userId = useAuthStore((s) => s.session?.userId ?? '');

  return (
    <TestScaffold
      id="reaction"
      Run={(p) => <ReactionRun {...p} />}
      format={(s) => `${s} ms`}
      onSaved={(r) => {
        // Alimenta el indicador "tiempo de reacción" (cerebro). Se compara con TU línea base, no con un umbral médico.
        const prev = resultsOf(useTestsStore.getState().results[userId], 'reaction').filter((x) => x !== r).slice(-7);
        const baseline = prev.length >= 3 ? prev.reduce((a, b) => a + b.score, 0) / prev.length : null;
        useHealthLogStore.getState().addReading(userId, {
          indicatorId: 'reactionTime',
          status: baseline === null ? 'unevaluated' : r.score > baseline * 1.15 ? 'caution' : 'normal',
          reading: { value: r.score, takenAt: r.createdAt, source: 'manual', synced: false },
        });
      }}
      extra={(r) => (
        <Card style={[styles.row, { gap: spacing.md }]}>
          <Stat label={t('tests.reaction.bestTrial')} value={`${r.details.best} ms`} />
          <Stat label={t('tests.reaction.falseStartsLabel')} value={String(r.details.falseStarts)} />
        </Card>
      )}
    />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.flex}>
      <AppText variant="h3">{value}</AppText>
      <AppText variant="caption" color="textMuted">{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
