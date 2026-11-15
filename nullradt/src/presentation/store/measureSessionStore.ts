import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { IndicatorId } from '@/domain/entities/HealthIndicator';
import { isMeasurable } from '@/domain/usecases/SimulateMeasurement';
import { todayKey, useRoutineStore } from './routineStore';

/**
 * Sesión de mediciones pendientes: se recorre en orden (paso a paso) o en el orden que elija el astronauta,
 * pero no se da por terminada hasta completar todas. Se guarda para retomarla si se sale a mitad.
 */
export type SessionMode = 'guided' | 'free';

/** Orden clínico habitual: presión primero (en reposo), luego oxígeno, pulso, respiración y temperatura. */
export const MEASURE_ORDER: IndicatorId[] = ['bloodPressure', 'spo2', 'heartRate', 'respRate', 'bodyTemperature', 'eyePressure', 'gripStrength', 'urinaryCalcium'];

export interface MeasureSession {
  userId: string;
  day: string;
  mode: SessionMode;
  items: IndicatorId[];
  done: IndicatorId[];
  startedAt: string;
  completedAt?: string;
}

interface MeasureSessionState {
  session: MeasureSession | null;
  start: (userId: string, items: IndicatorId[], mode: SessionMode) => void;
  setMode: (mode: SessionMode) => void;
  markDone: (id: IndicatorId) => void;
  clear: () => void;
}

export const useMeasureSessionStore = create<MeasureSessionState>()(
  persist(
    (set, get) => ({
      session: null,
      start: (userId, items, mode) =>
        set({ session: { userId, day: todayKey(), mode, items: MEASURE_ORDER.filter((i) => items.includes(i)), done: [], startedAt: new Date().toISOString() } }),
      setMode: (mode) => set((s) => (s.session ? { session: { ...s.session, mode } } : s)),
      markDone: (id) => {
        const s = get().session;
        if (!s || !s.items.includes(id) || s.done.includes(id)) return;
        const done = [...s.done, id];
        const complete = s.items.every((i) => done.includes(i));
        set({ session: { ...s, done, completedAt: complete ? new Date().toISOString() : undefined } });
        // Completar la sesión marca los signos vitales de la rutina.
        if (complete) {
          const routine = useRoutineStore.getState();
          if (!(routine.done[todayKey()] ?? []).includes('vitals')) routine.toggleDone('vitals');
        }
      },
      clear: () => set({ session: null }),
    }),
    { name: 'nullradt-measure-session', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

/** Sesión vigente (de hoy y del usuario actual). */
export const activeSession = (s: MeasureSession | null, userId: string) => (s && s.userId === userId && s.day === todayKey() ? s : null);
export const pendingOf = (s: MeasureSession) => s.items.filter((i) => !s.done.includes(i));

/** Abre la pantalla adecuada para medir un indicador dentro de la sesión. */
export function openMeasurement(id: IndicatorId, replace = false) {
  const href = { pathname: isMeasurable(id) ? '/measure' : '/register', params: { indicator: id, session: '1' } } as const;
  if (replace) router.replace(href);
  else router.push(href);
}
