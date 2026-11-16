import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppText, Card } from '@/presentation/components/ui';
import { TestScaffold, type TestRunProps } from '@/presentation/features/tests/TestScaffold';

/** 3×3 como los bloques de Corsi: casillas grandes y separadas (guantes, microgravedad). */
const GRID = 3;
const GAP = 16;
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
  const [bestShown, setBestShown] = useState(0);
  const [size, setSize] = useState(0);
  // Refs: los toques rápidos leen siempre el valor actual (el estado de React puede ir un render atrasado).
  const posRef = useRef(0);
  const phaseRef = useRef<Phase>('show');
  const seqRef = useRef(seq);
  /** Casilla que se está tocando: mientras haya un dedo apoyado, se ignoran las demás (un toque a la vez). */
  const touching = useRef<number | null>(null);
  const fails = useRef(0);
  const best = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const go = (p: Phase) => {
    phaseRef.current = p;
    // Si la casilla se desactivó con el dedo apoyado, onPressOut puede no llegar: se libera aquí.
    if (p === 'show' || p === 'input') touching.current = null;
    setPhase(p);
  };

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Muestra la secuencia celda por celda.
  useEffect(() => {
    if (phase !== 'show') return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    seq.forEach((cell, i) => {
      timers.current.push(setTimeout(() => setLit(cell), 700 + i * 700));
      timers.current.push(setTimeout(() => setLit(null), 700 + i * 700 + 480));
    });
    timers.current.push(
      setTimeout(() => {
        posRef.current = 0;
        setPos(0);
        go('input');
      }, 700 + seq.length * 700),
    );
  }, [phase, seq]);

  const nextRound = (nextLen: number) => {
    const s = makeSeq(nextLen);
    seqRef.current = s;
    setLen(nextLen);
    setSeq(s);
    go('show');
  };

  const pressIn = (cell: number) => {
    if (phaseRef.current !== 'input' || touching.current !== null) return;
    touching.current = cell;
    setLit(cell);
    const expected = seqRef.current[posRef.current];
    if (expected !== cell) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      fails.current++;
      go('bad');
      // Dos fallos seguidos terminan la prueba.
      if (fails.current >= 2) {
        timers.current.push(setTimeout(() => onComplete({ score: best.current, details: { span: best.current } }), 900));
      } else {
        timers.current.push(setTimeout(() => nextRound(seqRef.current.length), 1000));
      }
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    const next = posRef.current + 1;
    if (next === seqRef.current.length) {
      best.current = Math.max(best.current, seqRef.current.length);
      setBestShown(best.current);
      fails.current = 0;
      go('ok');
      timers.current.push(setTimeout(() => nextRound(seqRef.current.length + 1), 800));
    } else {
      posRef.current = next;
      setPos(next);
    }
  };

  const pressOut = (cell: number) => {
    if (touching.current !== cell) return;
    touching.current = null;
    timers.current.push(setTimeout(() => setLit((l) => (l === cell ? null : l)), 140));
  };

  // Tamaño exacto de cada casilla según el ancho disponible (sin porcentajes que dejen huecos sin respuesta).
  const onLayout = (e: LayoutChangeEvent) => setSize(Math.min(e.nativeEvent.layout.width, 420));
  const cell = size ? (size - GAP * (GRID - 1)) / GRID : 0;

  const msg =
    phase === 'show' ? t('tests.memory.watch') : phase === 'input' ? t('tests.memory.repeat', { n: pos + 1, total: seq.length }) : phase === 'ok' ? t('tests.memory.ok') : t('tests.memory.bad');

  return (
    <View style={[styles.flex, { gap: spacing.lg }]}>
      <Card tone="alt" style={[styles.row, { justifyContent: 'space-between' }]}>
        <AppText variant="label">{t('tests.memory.length', { n: len })}</AppText>
        <AppText variant="label" color="primaryText">{t('tests.memory.best', { n: bestShown })}</AppText>
      </Card>
      <AppText variant="h3" align="center" color={phase === 'bad' ? 'dangerText' : phase === 'ok' ? 'primaryText' : 'text'} accessibilityLiveRegion="polite">
        {msg}
      </AppText>
      <View onLayout={onLayout} style={styles.board}>
        {cell > 0 && (
          <View style={[styles.grid, { width: size, gap: GAP }]}>
            {Array.from({ length: GRID * GRID }).map((_, i) => {
              const on = lit === i;
              return (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  accessibilityLabel={`${i + 1}`}
                  disabled={phase !== 'input'}
                  onPressIn={() => pressIn(i)}
                  onPressOut={() => pressOut(i)}
                  style={{
                    width: cell,
                    height: cell,
                    borderRadius: radius.lg,
                    borderWidth: 2,
                    backgroundColor: on ? colors.primary : colors.night,
                    borderColor: on ? colors.primary : 'rgba(255,255,255,0.10)',
                    transform: [{ scale: on ? 0.96 : 1 }],
                  }}
                />
              );
            })}
          </View>
        )}
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
  board: { width: '100%', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
});
