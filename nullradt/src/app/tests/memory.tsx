import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppText, Card, PressableScale } from '@/presentation/components/ui';
import { TestScaffold, type TestRunProps } from '@/presentation/features/tests/TestScaffold';

const GRID = 4;
const START_LEN = 3;
type Phase = 'show' | 'input' | 'ok' | 'bad';

const makeSeq = (len: number) => {
  const seq: number[] = [];
  while (seq.length < len) {
    const c = Math.floor(Math.random() * GRID * GRID);
    if (seq[seq.length - 1] !== c) seq.push(c);
  }
  return seq;
};

/** Memoria espacial (tipo bloques de Corsi): repite la secuencia; cada acierto la alarga. */
function MemoryRun({ onComplete }: TestRunProps) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const [len, setLen] = useState(START_LEN);
  const [seq, setSeq] = useState(() => makeSeq(START_LEN));
  const [phase, setPhase] = useState<Phase>('show');
  const [lit, setLit] = useState<number | null>(null);
  const [pos, setPos] = useState(0);
  const fails = useRef(0);
  const best = useRef(0);
  const [bestShown, setBestShown] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Muestra la secuencia celda por celda.
  useEffect(() => {
    if (phase !== 'show') return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    seq.forEach((cell, i) => {
      timers.current.push(setTimeout(() => setLit(cell), 700 + i * 650));
      timers.current.push(setTimeout(() => setLit(null), 700 + i * 650 + 450));
    });
    timers.current.push(
      setTimeout(() => {
        setPos(0);
        setPhase('input');
      }, 700 + seq.length * 650),
    );
    return () => timers.current.forEach(clearTimeout);
  }, [phase, seq]);

  const nextRound = (nextLen: number) => {
    setLen(nextLen);
    setSeq(makeSeq(nextLen));
    setPhase('show');
  };

  const tap = (cell: number) => {
    if (phase !== 'input') return;
    setLit(cell);
    timers.current.push(setTimeout(() => setLit(null), 180));
    if (seq[pos] !== cell) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      fails.current++;
      setPhase('bad');
      // Dos fallos en la misma longitud terminan la prueba.
      if (fails.current >= 2) {
        timers.current.push(setTimeout(() => onComplete({ score: best.current, details: { span: best.current } }), 900));
      } else {
        timers.current.push(setTimeout(() => nextRound(len), 1000));
      }
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    if (pos + 1 === seq.length) {
      best.current = Math.max(best.current, len);
      setBestShown(best.current);
      fails.current = 0;
      setPhase('ok');
      timers.current.push(setTimeout(() => nextRound(len + 1), 800));
    } else {
      setPos(pos + 1);
    }
  };

  const msg =
    phase === 'show' ? t('tests.memory.watch') : phase === 'input' ? t('tests.memory.repeat', { n: pos + 1, total: seq.length }) : phase === 'ok' ? t('tests.memory.ok') : t('tests.memory.bad');

  return (
    <View style={[styles.flex, { gap: spacing.lg }]}>
      <Card tone="alt" style={[styles.row, { justifyContent: 'space-between' }]}>
        <AppText variant="label">{t('tests.memory.length', { n: len })}</AppText>
        <AppText variant="label" color="primaryText">{t('tests.memory.best', { n: bestShown })}</AppText>
      </Card>
      <AppText variant="h3" align="center" color={phase === 'bad' ? 'dangerText' : phase === 'ok' ? 'primaryText' : 'text'}>{msg}</AppText>
      <View style={[styles.grid, { gap: spacing.sm }]}>
        {Array.from({ length: GRID * GRID }).map((_, i) => {
          const on = lit === i;
          return (
            <PressableScale
              key={i}
              accessibilityLabel={`${i + 1}`}
              disabled={phase !== 'input'}
              onPress={() => tap(i)}
              style={[
                styles.cell,
                {
                  borderRadius: radius.md,
                  backgroundColor: on ? colors.primary : colors.night,
                  borderColor: on ? colors.primary : 'rgba(255,255,255,0.08)',
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

export default function MemoryTest() {
  return <TestScaffold id="memory" Run={(p) => <MemoryRun {...p} />} format={(s) => String(s)} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'center', width: '100%', maxWidth: 360 },
  cell: { width: '23%', aspectRatio: 1, borderWidth: 1 },
});
