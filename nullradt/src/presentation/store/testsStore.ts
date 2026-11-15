import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { todayKey } from './routineStore';

export type TestId = 'reaction' | 'vision' | 'stroop' | 'memory';
export const TEST_IDS: TestId[] = ['reaction', 'vision', 'stroop', 'memory'];

/** Para reflejos, menos es mejor (ms); para el resto, más es mejor. */
export const LOWER_IS_BETTER: Record<TestId, boolean> = { reaction: true, vision: false, stroop: false, memory: false };

export interface TestResult {
  testId: TestId;
  day: string;
  createdAt: string;
  /** Valor principal comparable entre días. */
  score: number;
  /** Datos extra para mostrar (p. ej. errores, por ojo). */
  details: Record<string, number>;
}

interface TestsState {
  results: Record<string, TestResult[]>;
  add: (userId: string, r: Omit<TestResult, 'day' | 'createdAt'>) => TestResult;
}

export const useTestsStore = create<TestsState>()(
  persist(
    (set) => ({
      results: {},
      add: (userId, r) => {
        const full: TestResult = { ...r, day: todayKey(), createdAt: new Date().toISOString() };
        set((s) => ({ results: { ...s.results, [userId]: [...(s.results[userId] ?? []), full].slice(-300) } }));
        return full;
      },
    }),
    { name: 'nullradt-tests', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export const resultsOf = (all: TestResult[] | undefined, id: TestId) => (all ?? []).filter((r) => r.testId === id);

/** Mejor marca personal (excluye el resultado indicado, para comparar). */
export function personalBest(list: TestResult[], exclude?: TestResult) {
  const others = list.filter((r) => r !== exclude);
  if (!others.length) return null;
  const scores = others.map((r) => r.score);
  return LOWER_IS_BETTER[others[0]!.testId] ? Math.min(...scores) : Math.max(...scores);
}

/** Días seguidos con al menos un test. */
export function testStreak(all: TestResult[] = []) {
  const days = new Set(all.map((r) => r.day));
  let streak = 0;
  const d = new Date();
  if (!days.has(todayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(todayKey(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
