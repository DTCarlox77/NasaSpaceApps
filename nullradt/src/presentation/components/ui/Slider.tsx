import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { GestureDetector, usePanGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import { useAppTheme } from '@/core/theme';
import { AppText } from './AppText';

export interface SliderProps {
  label: string;
  /** 0–100 por dentro. NUNCA se muestra como número (check-in confidencial). */
  value: number | null;
  onChange: (value: number) => void;
  low: string;
  high: string;
}

const THUMB = 28;
const STEP = 10;

/**
 * Deslizador continuo SIN números visibles (check-in de bienestar, guía §11). Solo dos etiquetas en los
 * extremos. Arrastra o toca la pista; con lector de pantalla se ajusta de a 10 con las acciones de incremento.
 * Neutro: la pista no cambia de color según el valor.
 */
export function Slider({ label, value, onChange, low, high }: SliderProps) {
  const { colors, spacing, radius } = useAppTheme();
  const [width, setWidth] = useState(0);
  const touched = value !== null;
  const pos = value ?? 50;

  const setFromX = (x: number) => {
    if (!width) return;
    const next = Math.round(Math.max(0, Math.min(1, (x - THUMB / 2) / (width - THUMB))) * 100);
    if (next !== value) onChange(next);
  };

  const pan = usePanGesture({
    runOnJS: true,
    activeOffsetX: [-4, 4],
    failOffsetY: [-14, 14],
    onUpdate: (e) => setFromX(e.x),
    onFinalize: () => {
      Haptics.selectionAsync().catch(() => {});
    },
  });
  const tap = useTapGesture({
    runOnJS: true,
    onDeactivate: (e) => {
      setFromX(e.x);
      Haptics.selectionAsync().catch(() => {});
    },
  });
  const gesture = useSimultaneousGestures(pan, tap);

  const describe = pos < 34 ? low : pos > 66 ? high : `${low} – ${high}`;

  return (
    <View style={{ gap: spacing.sm }}>
      <AppText variant="title">{label}</AppText>
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ text: touched ? describe : '—' }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => onChange(Math.max(0, Math.min(100, pos + (e.nativeEvent.actionName === 'increment' ? STEP : -STEP))))}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
          style={styles.hit}
        >
          <View style={[styles.track, { backgroundColor: colors.progressTrack, borderRadius: radius.pill }]} />
          <View
            style={[
              styles.thumb,
              {
                left: width ? (pos / 100) * (width - THUMB) : 0,
                backgroundColor: touched ? colors.night : colors.surface,
                borderColor: touched ? colors.night : colors.borderStrong,
              },
            ]}
          />
        </View>
      </GestureDetector>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <AppText variant="caption" color="textMuted">{low}</AppText>
        <AppText variant="caption" color="textMuted">{high}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  hit: { height: 44, justifyContent: 'center' },
  track: { height: 8, marginHorizontal: THUMB / 2 },
  thumb: { position: 'absolute', width: THUMB, height: THUMB, borderRadius: THUMB / 2, borderWidth: 2 },
});
