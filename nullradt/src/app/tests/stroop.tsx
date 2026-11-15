import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppText, Card, PressableScale } from '@/presentation/components/ui';
import { TestScaffold, type TestRunProps } from '@/presentation/features/tests/TestScaffold';

const ITEMS = 20;
/** Reloj de alta resolución (fuera del componente: solo se usa en manejadores). */
const clock = () => performance.now();
const COLORS = [
  { id: 'red', hex: '#DE5149' },
  { id: 'green', hex: '#3FBF6E' },
  { id: 'blue', hex: '#3D7BE0' },
  { id: 'yellow', hex: '#E0B020' },
] as const;
type ColorId = (typeof COLORS)[number]['id'];

const pickIdx = (n: number, not?: number) => {
  let i = Math.floor(Math.random() * n);
  if (not !== undefined && i === not) i = (i + 1 + Math.floor(Math.random() * (n - 1))) % n;
  return i;
};
/** 75 % incongruentes (la palabra no coincide con el color de la tinta). */
const nextItem = () => {
  const ink = pickIdx(COLORS.length);
  const word = Math.random() < 0.75 ? pickIdx(COLORS.length, ink) : ink;
  return { ink, word };
};

/** Test de Stroop: toca el COLOR DE LA TINTA, no lo que dice la palabra. */
function StroopRun({ onComplete }: TestRunProps) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const [item, setItem] = useState(nextItem);
  const [n, setN] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [flash, setFlash] = useState<'ok' | 'bad' | null>(null);
  const startedAt = useRef(0);
  const shownAt = useRef(0);
  const rts = useRef<number[]>([]);
  useEffect(() => {
    shownAt.current = clock();
    startedAt.current = shownAt.current;
  }, []);

  const answer = (id: ColorId) => {
    const now = clock();
    const ok = COLORS[item.ink]!.id === id;
    rts.current.push(now - shownAt.current);
    const nextCorrect = correct + (ok ? 1 : 0);
    setCorrect(nextCorrect);
    setFlash(ok ? 'ok' : 'bad');
    if (ok) Haptics.selectionAsync().catch(() => {});
    else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});

    if (n + 1 >= ITEMS) {
      const seconds = Math.max((now - startedAt.current) / 1000, 1);
      const avg = rts.current.length ? Math.round(rts.current.reduce((a, b) => a + b, 0) / rts.current.length) : 0;
      // Eficiencia = aciertos por minuto (combina rapidez y precisión).
      onComplete({ score: Math.round((nextCorrect / seconds) * 60), details: { correct: nextCorrect, total: ITEMS, avgMs: avg } });
      return;
    }
    setN(n + 1);
    setItem(nextItem());
    shownAt.current = clock();
  };

  return (
    <View style={[styles.flex, { gap: spacing.lg }]}>
      <Card tone="alt" style={[styles.row, { justifyContent: 'space-between' }]}>
        <AppText variant="label">{t('tests.stroop.progress', { n: n + 1, total: ITEMS })}</AppText>
        <AppText variant="label" color="primaryText">{t('tests.stroop.correct', { count: correct })}</AppText>
      </Card>
      <View
        style={[
          styles.flex,
          styles.center,
          { borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 2, borderColor: flash === 'ok' ? colors.primary : flash === 'bad' ? colors.status.critical.solid : colors.border },
        ]}
      >
        <AppText variant="caption" color="textMuted">{t('tests.stroop.prompt')}</AppText>
        <AppText style={{ fontSize: 56, lineHeight: 68, fontFamily: 'Lexend-SemiBold', color: COLORS[item.ink]!.hex }}>
          {t(`tests.stroop.colors.${COLORS[item.word]!.id}`).toUpperCase()}
        </AppText>
      </View>
      <View style={[styles.wrap, { gap: spacing.md }]}>
        {COLORS.map((c) => (
          <PressableScale
            key={c.id}
            accessibilityLabel={t(`tests.stroop.colors.${c.id}`)}
            onPress={() => answer(c.id)}
            style={[styles.swatch, { borderRadius: radius.button, backgroundColor: c.hex }]}
          >
            <AppText variant="title" style={{ color: c.id === 'yellow' ? '#13201A' : '#FFFFFF' }}>{t(`tests.stroop.colors.${c.id}`)}</AppText>
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

export default function StroopTest() {
  const { t } = useTranslation();
  const { spacing } = useAppTheme();
  return (
    <TestScaffold
      id="stroop"
      Run={(p) => <StroopRun {...p} />}
      format={(s) => String(s)}
      extra={(r) => (
        <Card style={[styles.row, { gap: spacing.md }]}>
          <View style={styles.flex}>
            <AppText variant="h3">{r.details.correct}/{r.details.total}</AppText>
            <AppText variant="caption" color="textMuted">{t('tests.stroop.accuracy')}</AppText>
          </View>
          <View style={styles.flex}>
            <AppText variant="h3">{r.details.avgMs} ms</AppText>
            <AppText variant="caption" color="textMuted">{t('tests.stroop.avgTime')}</AppText>
          </View>
        </Card>
      )}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  center: { alignItems: 'center', justifyContent: 'center' },
  swatch: { flexBasis: '45%', flexGrow: 1, height: 64, alignItems: 'center', justifyContent: 'center' },
});
