import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { todayKey } from './routineStore';

export const SYMPTOMS = ['headache', 'nausea', 'congestion', 'backPain', 'blurredVision', 'insomnia', 'fatigue', 'none'] as const;
export type Symptom = (typeof SYMPTOMS)[number];

/** Check diario de bienestar (autorreporte). Confidencial: se guarda solo en el dispositivo. */
export interface CheckIn {
  day: string; // YYYY-MM-DD
  mood: number; // 1–5
  energy: number; // 1–5
  stress: number; // 1–5
  sleepHours: number;
  symptoms: Symptom[];
  note?: string;
  createdAt: string;
}

interface CheckInState {
  /** Por usuario → por día. */
  entries: Record<string, Record<string, CheckIn>>;
  save: (userId: string, entry: Omit<CheckIn, 'day' | 'createdAt'>) => CheckIn;
}

export const useCheckInStore = create<CheckInState>()(
  persist(
    (set) => ({
      entries: {},
      save: (userId, entry) => {
        const full: CheckIn = { ...entry, day: todayKey(), createdAt: new Date().toISOString() };
        set((s) => ({ entries: { ...s.entries, [userId]: { ...(s.entries[userId] ?? {}), [full.day]: full } } }));
        return full;
      },
    }),
    { name: 'nullradt-checkins', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

/** Días consecutivos con check (hasta hoy, o hasta ayer si hoy aún no se hace). */
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

/** Señales del autorreporte que conviene comentar con la tripulación (no es diagnóstico). */
export function checkInFlags(c: CheckIn): ('lowMood' | 'highStress' | 'poorSleep' | 'vision')[] {
  const flags: ('lowMood' | 'highStress' | 'poorSleep' | 'vision')[] = [];
  if (c.mood <= 2) flags.push('lowMood');
  if (c.stress >= 4) flags.push('highStress');
  if (c.sleepHours < 6) flags.push('poorSleep');
  if (c.symptoms.includes('blurredVision')) flags.push('vision');
  return flags;
}
