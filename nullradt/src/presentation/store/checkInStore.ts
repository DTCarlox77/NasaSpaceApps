import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { VasDimension } from '@/domain/wellbeing/trends';
import { todayKey } from './routineStore';

export const SYMPTOMS = ['headache', 'nausea', 'congestion', 'backPain', 'blurredVision', 'insomnia', 'fatigue', 'none'] as const;
export type Symptom = (typeof SYMPTOMS)[number];

/**
 * Check-in diario de bienestar (~20 s). Confidencial: el detalle solo lo ven el astronauta y salud conductual.
 * Escalas visuales SIN números (0–100 internamente): ánimo, fatiga, estrés y roces con la tripulación.
 */
export interface CheckIn {
  day: string; // YYYY-MM-DD
  vas: Partial<Record<VasDimension, number>>;
  sleepHours: number;
  /** wristband = dato de la pulsera (sintético en la demo) · manual = corregido por el astronauta. */
  sleepSource: 'wristband' | 'manual';
  symptoms: Symptom[];
  note?: string;
  createdAt: string;
  synthetic?: boolean;
}

interface CheckInState {
  /** Por usuario → por día. */
  entries: Record<string, Record<string, CheckIn>>;
  save: (userId: string, entry: Omit<CheckIn, 'day' | 'createdAt'>) => CheckIn;
  /** Demo: rellena 14 días de historial SINTÉTICO (marcado) para ver la detección de cambios sostenidos. */
  seedSynthetic: (userId: string, worsening: boolean) => void;
}

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export const useCheckInStore = create<CheckInState>()(
  persist(
    (set) => ({
      entries: {},
      save: (userId, entry) => {
        const full: CheckIn = { ...entry, day: todayKey(), createdAt: new Date().toISOString() };
        set((s) => ({ entries: { ...s.entries, [userId]: { ...(s.entries[userId] ?? {}), [full.day]: full } } }));
        return full;
      },
      seedSynthetic: (userId, worsening) =>
        set((s) => {
          const mine = { ...(s.entries[userId] ?? {}) };
          for (let i = 14; i >= 1; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const day = todayKey(d);
            if (mine[day]) continue;
            const late = worsening && i <= 3;
            const n = () => (Math.random() - 0.5) * 12;
            mine[day] = {
              day,
              vas: { mood: clamp((late ? 30 : 70) + n()), fatigue: clamp((late ? 75 : 35) + n()), stress: clamp((late ? 72 : 30) + n()), friction: clamp((late ? 55 : 15) + n()) },
              sleepHours: late ? 5 : 7 + Math.round(Math.random() * 2) / 2,
              sleepSource: 'wristband',
              symptoms: [],
              createdAt: d.toISOString(),
              synthetic: true,
            };
          }
          return { entries: { ...s.entries, [userId]: mine } };
        }),
    }),
    {
      name: 'nullradt-checkins',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      // v0 usaba escalas 1–5 (ánimo, energía, estrés): se convierten a 0–100.
      migrate: (persisted, version) => {
        const state = persisted as { entries: Record<string, Record<string, Record<string, unknown>>> };
        if (version === 0 && state?.entries) {
          for (const byDay of Object.values(state.entries)) {
            for (const [day, e] of Object.entries(byDay)) {
              if (e.vas) continue;
              const mood = typeof e.mood === 'number' ? (e.mood - 1) * 25 : undefined;
              const fatigue = typeof e.energy === 'number' ? (5 - e.energy) * 25 : undefined;
              const stress = typeof e.stress === 'number' ? (e.stress - 1) * 25 : undefined;
              byDay[day] = { ...e, vas: { mood, fatigue, stress }, sleepSource: 'manual' };
            }
          }
        }
        return state as unknown as CheckInState;
      },
    },
  ),
);

/** Días consecutivos con check (hasta hoy, o hasta ayer si hoy aún no se hace). Premia completar, no el resultado. */
export function streakOf(byDay: Record<string, CheckIn> = {}) {
  let streak = 0;
  const d = new Date();
  if (!byDay[todayKey(d)]) d.setDate(d.getDate() - 1);
  while (byDay[todayKey(d)]) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/** Sueño de la pulsera (SINTÉTICO en la demo: no hay pulsera conectada). Determinista por día. */
export function wristbandSleep(day = todayKey()): number {
  let h = 0;
  for (const c of day) h = (h * 31 + c.charCodeAt(0)) % 997;
  return 6 + (h % 5) * 0.5; // 6.0 – 8.0 h
}
