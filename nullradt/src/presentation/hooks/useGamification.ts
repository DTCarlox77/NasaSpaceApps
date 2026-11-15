import { useMemo } from 'react';
import { summarize } from '@/domain/gamification/achievements';
import { useAuthStore } from '@/presentation/store/authStore';
import { useCheckInStore } from '@/presentation/store/checkInStore';
import { useHealthLogStore } from '@/presentation/store/healthLogStore';
import { todayKey, useRoutineStore } from '@/presentation/store/routineStore';
import { useTestsStore } from '@/presentation/store/testsStore';
import { useWellbeingStore } from '@/presentation/store/wellbeingStore';

const dayOf = (iso: string) => todayKey(new Date(iso));
const countBy = (days: string[]) => days.reduce<Record<string, number>>((acc, d) => ((acc[d] = (acc[d] ?? 0) + 1), acc), {});

/** Junta la actividad de todos los módulos y calcula puntos, rachas y logros. */
export function useGamification() {
  const userId = useAuthStore((s) => s.session?.userId ?? '');
  const readings = useHealthLogStore((s) => s.readings[userId]);
  const checkIns = useCheckInStore((s) => s.entries[userId]);
  const tests = useTestsStore((s) => s.results[userId]);
  const done = useRoutineStore((s) => s.done);
  const screenings = useWellbeingStore((s) => s.screenings[userId]);
  const fitness = useWellbeingStore((s) => s.fitness[userId]);

  return useMemo(() => {
    const exerciseByDay: Record<string, number> = {};
    const sleepDays = new Set<string>();
    Object.entries(done).forEach(([day, ids]) => {
      const n = ids.filter((i) => i === 'aerobic' || i === 'resistance').length;
      if (n) exerciseByDay[day] = n;
      if (ids.includes('sleep')) sleepDays.add(day);
    });
    // Registrar las horas de sueño en el check-in también cuenta como "sueño registrado".
    Object.values(checkIns ?? {}).forEach((c) => c.sleepHours > 0 && sleepDays.add(c.day));
    return summarize({
      readingsByDay: countBy((readings ?? []).map((r) => dayOf(r.reading.takenAt))),
      cameraReadings: (readings ?? []).filter((r) => r.reading.source === 'camera').length,
      checkInDays: Object.keys(checkIns ?? {}),
      testsByDay: countBy((tests ?? []).map((r) => r.day)),
      exerciseByDay,
      sleepDays: [...sleepDays],
      screenings: screenings?.length ?? 0,
      fitnessChecks: fitness?.length ?? 0,
      today: todayKey(),
    });
  }, [readings, checkIns, tests, done, screenings, fitness]);
}
