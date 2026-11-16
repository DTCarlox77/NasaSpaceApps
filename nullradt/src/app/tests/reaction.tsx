import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { apiEnabled } from '@/core/config/env';
import { palette, useAppTheme } from '@/core/theme';
import type { Fitness } from '@/domain/entities/Wellbeing';
import { pvtMetrics } from '@/domain/usecases/WellbeingUseCases';
import { container } from '@/di/container';
import { AppText, Card, ToggleRow } from '@/presentation/components/ui';
import { TestScaffold, type TestRunProps } from '@/presentation/features/tests/TestScaffold';
import { useAuthStore } from '@/presentation/store/authStore';
import { useHealthLogStore } from '@/presentation/store/healthLogStore';
import { refreshPendingCount } from '@/presentation/sync/syncEngine';
import { evaluateFitness } from '@/domain/wellbeing/fitness';
import { useDeviceStore } from '@/presentation/store/deviceStore';
import { todayKey, useRoutineStore } from '@/presentation/store/routineStore';
import { useWellbeingStore } from '@/presentation/store/wellbeingStore';

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
  const startedAt = useRef(0);
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
    startedAt.current = performance.now();
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
      // Se mide cada estímulo: métricas del PVT para POST /wellbeing/pvt-runs (lapso = respuesta ≥ 355 ms).
      const m = pvtMetrics(next);
      const durationS = Math.max(1, Math.round((performance.now() - startedAt.current) / 1000));
      timer.current = setTimeout(
        () =>
          onComplete({
            score: median(next),
            details: { best: Math.min(...next), falseStarts: falseStarts.current, trials: m.trials, lapses: m.lapses, meanRtMs: m.meanRtMs, durationS },
          }),
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

type PvtState = { status: 'sending' } | { status: 'sent'; fitness: Fitness; message: string } | { status: 'queued' | 'local' | 'error' };

export default function ReactionTest() {
  const { t } = useTranslation();
  const { spacing, colors } = useAppTheme();
  const userId = useAuthStore((s) => s.session?.userId ?? '');
  const [beforeCritical, setBeforeCritical] = useState(false);
  const [pvt, setPvt] = useState<PvtState | null>(null);
  const withApi = apiEnabled();

  return (
    <TestScaffold
      id="reaction"
      Run={(p) => <ReactionRun {...p} />}
      format={(s) => `${s} ms`}
      introExtra={
        withApi ? (
          <ToggleRow icon="construct-outline" title={t('tests.pvt.beforeCritical')} value={beforeCritical} onValueChange={setBeforeCritical} />
        ) : undefined
      }
      onSaved={(r) => {
        // El PVT es confidencial (bienestar): el indicador del cuerpo queda "sin evaluar", sin semáforo propio.
        useHealthLogStore.getState().addReading(userId, {
          indicatorId: 'reactionTime',
          status: 'unevaluated',
          reading: { value: r.score, takenAt: r.createdAt, source: 'manual', synced: false },
        });
        // Registro local de aptitud (rutina "apto para tarea crítica" y logros): con API, el veredicto del servidor.
        const record = (fit: 'yes' | 'notConfirmed' | 'baseline') => {
          useWellbeingStore.getState().addFitness(userId, {
            deviceId: useDeviceStore.getState().deviceId,
            durationSec: r.details.durationS ?? 0,
            meanRt: r.details.meanRtMs ?? r.score,
            lapses: r.details.lapses ?? 0,
            falseStarts: r.details.falseStarts ?? 0,
            responses: r.details.trials ?? 0,
            fit,
          });
          const routine = useRoutineStore.getState();
          if (fit === 'yes' && !(routine.done[todayKey()] ?? []).includes('fitCheck')) routine.toggleDone('fitCheck');
        };
        if (!withApi) {
          // Demo: línea base personal en este dispositivo (domain/wellbeing/fitness).
          const ws = useWellbeingStore.getState();
          const summary = { meanRt: r.details.meanRtMs ?? r.score, lapses: r.details.lapses ?? 0, falseStarts: r.details.falseStarts ?? 0, responses: r.details.trials ?? 0, durationSec: r.details.durationS ?? 0, deviceId: useDeviceStore.getState().deviceId };
          record(evaluateFitness(summary, ws.fitness[userId] ?? []));
          return;
        }
        setPvt({ status: 'sending' });
        container.submitPvtRun
          .execute({
            measuredAt: r.createdAt,
            beforeCriticalTask: beforeCritical,
            durationS: r.details.durationS,
            trials: r.details.trials ?? 0,
            lapses: r.details.lapses ?? 0,
            meanRtMs: r.details.meanRtMs ?? r.score,
            falseStarts: r.details.falseStarts ?? 0,
          })
          .then((out) => {
            setPvt(out.status === 'sent' ? { status: 'sent', fitness: out.fitness, message: out.message } : { status: out.status });
            if (out.status === 'sent') record(out.fitness === 'fit' ? 'yes' : 'notConfirmed');
            if (out.status === 'queued') void refreshPendingCount();
          })
          .catch(() => setPvt({ status: 'error' }));
      }}
      extra={(r) => (
        <>
          <Card style={[styles.row, { gap: spacing.md }]}>
            <Stat label={t('tests.reaction.bestTrial')} value={`${r.details.best} ms`} />
            <Stat label={t('tests.reaction.falseStartsLabel')} value={String(r.details.falseStarts)} />
          </Card>
          {withApi && pvt && (
            <Card tone="alt" style={{ gap: spacing.xs }}>
              <AppText variant="label" color="textMuted">{t('tests.pvt.fitnessTitle')}</AppText>
              {pvt.status === 'sent' ? (
                <>
                  <AppText variant="h3" style={{ color: colors.text }}>{t(`tests.pvt.fitness.${pvt.fitness}`)}</AppText>
                  <AppText variant="bodySmall" color="textSecondary">{pvt.message}</AppText>
                </>
              ) : (
                <AppText variant="bodySmall" color="textSecondary">{t(`tests.pvt.state.${pvt.status}`)}</AppText>
              )}
            </Card>
          )}
        </>
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
