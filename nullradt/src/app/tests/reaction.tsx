import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import i18n from '@/core/i18n';
import { palette, useAppTheme } from '@/core/theme';
import { evaluateFitness, PVTB } from '@/domain/wellbeing/fitness';
import { AppText, Card, ProgressBar, SegmentedControl } from '@/presentation/components/ui';
import { TestScaffold, type TestRunProps } from '@/presentation/features/tests/TestScaffold';
import { useAuthStore } from '@/presentation/store/authStore';
import { useDeviceStore } from '@/presentation/store/deviceStore';
import { useHealthLogStore } from '@/presentation/store/healthLogStore';
import { sendToEarth } from '@/presentation/store/outboxStore';
import { todayKey, useRoutineStore } from '@/presentation/store/routineStore';
import { resultsOf, useTestsStore } from '@/presentation/store/testsStore';
import { useWellbeingStore } from '@/presentation/store/wellbeingStore';

type State = 'wait' | 'go' | 'early' | 'hit';
type Mode = 'full' | 'demo';

/**
 * Prueba de reacción INSPIRADA en la PVT-B (3 min): estímulos a intervalos aleatorios de 1–4 s,
 * lapso = respuesta ≥ 355 ms, salida en falso = toque antes del estímulo o < 100 ms.
 * No es el software validado de NASA. Línea base personal y por dispositivo.
 */
function ReactionRun({ onComplete, durationSec }: TestRunProps & { durationSec: number }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const [state, setState] = useState<State>('wait');
  const [last, setLast] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [stats, setStats] = useState({ responses: 0, lapses: 0, falseStarts: 0 });
  const rts = useRef<number[]>([]);
  const falseStarts = useRef(0);
  const goAt = useRef(0);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finished = useRef(false);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    if (timer.current) clearTimeout(timer.current);
    const valid = rts.current;
    const mean = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : 0;
    const lapses = valid.filter((r) => r >= PVTB.lapseMs).length;
    onComplete({ score: mean, details: { best: valid.length ? Math.min(...valid) : 0, falseStarts: falseStarts.current, trials: valid.length, lapses, durationSec } });
  };

  const arm = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      goAt.current = performance.now();
      setState('go');
    }, PVTB.isiMinMs + Math.random() * (PVTB.isiMaxMs - PVTB.isiMinMs));
  };

  useEffect(() => {
    startedAt.current = performance.now();
    arm();
    const clock = setInterval(() => {
      const s = (performance.now() - startedAt.current) / 1000;
      setElapsed(s);
      if (s >= durationSec) finish();
    }, 250);
    return () => {
      clearInterval(clock);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPress = () => {
    if (finished.current) return;
    const now = performance.now();
    if (state !== 'go' || now - goAt.current < PVTB.falseStartMs) {
      falseStarts.current++;
      setStats((st) => ({ ...st, falseStarts: falseStarts.current }));
      setState('early');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setState('wait');
        arm();
      }, 700);
      return;
    }
    const ms = Math.round(now - goAt.current);
    rts.current.push(ms);
    setStats((st) => ({ ...st, responses: rts.current.length, lapses: rts.current.filter((r) => r >= PVTB.lapseMs).length }));
    setLast(ms);
    setState('hit');
    timer.current = setTimeout(() => {
      setState('wait');
      arm();
    }, 350);
  };

  const bg = state === 'go' ? colors.primary : state === 'early' ? palette.orange[600] : colors.night;
  const label = state === 'go' ? t('tests.reaction.now') : state === 'early' ? t('tests.reaction.early') : state === 'hit' ? `${last} ms` : t('tests.reaction.wait');

  return (
    <View style={[styles.flex, { gap: spacing.md }]}>
      <ProgressBar value={Math.min(1, elapsed / durationSec)} color={colors.primary} label={t('wellbeingPlus.pvt.remaining', { seconds: Math.max(0, Math.ceil(durationSec - elapsed)) })} />
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
        <AppText variant="label">{t('wellbeingPlus.pvt.responses', { count: stats.responses })}</AppText>
        <AppText variant="label" color="accentText">{t('tests.reaction.falseStarts', { count: stats.falseStarts })}</AppText>
      </Card>
    </View>
  );
}

export default function ReactionTest() {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const userId = useAuthStore((s) => s.session?.userId ?? '');
  const [mode, setMode] = useState<Mode>('full');
  const durationSec = mode === 'full' ? PVTB.durationSec : PVTB.demoDurationSec;
  const [fit, setFit] = useState<'yes' | 'notConfirmed' | 'baseline' | null>(null);

  return (
    <TestScaffold
      id="reaction"
      introExtra={
        <Card style={{ gap: spacing.sm }}>
          <AppText variant="title">{t('wellbeingPlus.pvt.duration')}</AppText>
          <SegmentedControl<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'full', label: t('wellbeingPlus.pvt.full') },
              { value: 'demo', label: t('wellbeingPlus.pvt.demo') },
            ]}
          />
          <AppText variant="caption" color="textMuted">{t('wellbeingPlus.pvt.disclaimer')}</AppText>
        </Card>
      }
      Run={(p) => <ReactionRun {...p} durationSec={durationSec} />}
      format={(s) => `${s} ms`}
      onSaved={(r) => {
        const deviceId = useDeviceStore.getState().deviceId;
        const ws = useWellbeingStore.getState();
        const previous = (ws.fitness[userId] ?? []).map((f) => ({ ...f }));
        const summary = { meanRt: r.score, lapses: r.details.lapses ?? 0, falseStarts: r.details.falseStarts ?? 0, responses: r.details.trials ?? 0, durationSec, deviceId };
        const verdict = evaluateFitness(summary, previous);
        ws.addFitness(userId, { ...summary, fit: verdict });
        setFit(verdict);
        // A control de misión SOLO llega "apto: sí / no confirmado" (nunca los tiempos).
        sendToEarth({
          kind: 'fitness',
          audience: 'missionControl',
          fromId: userId,
          subjectId: userId,
          title: i18n.t('wellbeingPlus.pvt.earthTitle'),
          body: verdict === 'yes' ? i18n.t('wellbeingPlus.pvt.fitYes') : i18n.t('wellbeingPlus.pvt.fitNotConfirmed'),
          confidential: false,
        });
        // Alimenta el indicador "tiempo de reacción" (cerebro): se compara con TU línea base.
        const prev = resultsOf(useTestsStore.getState().results[userId], 'reaction').filter((x) => x !== r).slice(-7);
        const baseline = prev.length >= 3 ? prev.reduce((a, b) => a + b.score, 0) / prev.length : null;
        useHealthLogStore.getState().addReading(userId, {
          indicatorId: 'reactionTime',
          status: baseline === null ? 'unevaluated' : r.score > baseline * 1.15 ? 'caution' : 'normal',
          reading: { value: r.score, takenAt: r.createdAt, source: 'manual', synced: false },
        });
        const routine = useRoutineStore.getState();
        if (verdict === 'yes' && !(routine.done[todayKey()] ?? []).includes('fitCheck')) routine.toggleDone('fitCheck');
      }}
      extra={(r) => (
        <>
          {fit && (
            <Card style={[styles.row, { gap: spacing.md, backgroundColor: fit === 'yes' ? colors.status.normal.background : colors.status.caution.background, borderColor: fit === 'yes' ? colors.status.normal.ring : colors.status.caution.ring }]}>
              <Ionicons name={fit === 'yes' ? 'shield-checkmark' : 'shield-outline'} size={28} color={fit === 'yes' ? colors.status.normal.text : colors.status.caution.text} />
              <View style={styles.flex}>
                <AppText variant="title">{t(`wellbeingPlus.pvt.verdict.${fit}`)}</AppText>
                <AppText variant="caption" color="textSecondary">{t('wellbeingPlus.pvt.onlyFitToEarth')}</AppText>
              </View>
            </Card>
          )}
          <Card style={[styles.row, { gap: spacing.md }]}>
            <Stat label={t('wellbeingPlus.pvt.lapses')} value={String(r.details.lapses ?? 0)} />
            <Stat label={t('tests.reaction.falseStartsLabel')} value={String(r.details.falseStarts)} />
            <Stat label={t('tests.reaction.bestTrial')} value={`${r.details.best} ms`} />
          </Card>
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
