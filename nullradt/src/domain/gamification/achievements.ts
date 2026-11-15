/**
 * Gamificación (función pura). Regla de diseño: se premia COMPLETAR (medir, hacer el check-in, entrenar, dormir
 * registrando el sueño), NUNCA el resultado: un valor "malo" suma exactamente lo mismo que uno "bueno",
 * para no incentivar ocultar síntomas.
 */

export interface ActivityInput {
  /** Días (YYYY-MM-DD) → nº de mediciones ese día. */
  readingsByDay: Record<string, number>;
  cameraReadings: number;
  checkInDays: string[];
  /** Días → nº de tests cognitivos completados. */
  testsByDay: Record<string, number>;
  /** Días con ejercicio completado (aeróbico o resistencia) → sesiones. */
  exerciseByDay: Record<string, number>;
  sleepDays: string[];
  screenings: number;
  fitnessChecks: number;
  today: string;
}

export type StreakId = 'checkIn' | 'measurement' | 'exercise' | 'sleep';
export type BadgeId =
  | 'firstMeasurement'
  | 'tenMeasurements'
  | 'checkIn7'
  | 'checkIn30'
  | 'exercise5'
  | 'sleep7'
  | 'allTests'
  | 'camera'
  | 'screening'
  | 'fitCheck';

export interface Badge {
  id: BadgeId;
  icon: string;
  current: number;
  target: number;
  unlocked: boolean;
}

export interface GamificationSummary {
  points: number;
  level: number;
  /** Puntos dentro del nivel actual y puntos por nivel. */
  levelProgress: number;
  levelSize: number;
  todayPoints: number;
  streaks: Record<StreakId, number>;
  badges: Badge[];
  breakdown: { measurements: number; checkIns: number; tests: number; exercise: number; sleep: number; bonus: number };
}

export const POINTS = { measurement: 10, checkIn: 15, test: 10, exercise: 20, sleep: 10, screening: 25, fitness: 15 } as const;
/** Límite diario por tipo (evita "farmear" puntos repitiendo). */
const DAILY_CAP = { measurement: 5, test: 4, exercise: 2 } as const;
const LEVEL_SIZE = 250;

const prevDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d! - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

/** Días consecutivos hasta hoy (o hasta ayer si hoy aún no se ha hecho). */
export function streakOf(days: Iterable<string>, today: string): number {
  const set = new Set(days);
  let d = set.has(today) ? today : prevDay(today);
  let n = 0;
  while (set.has(d)) {
    n++;
    d = prevDay(d);
  }
  return n;
}

const sumCapped = (byDay: Record<string, number>, cap: number) => Object.values(byDay).reduce((a, n) => a + Math.min(n, cap), 0);

export function summarize(a: ActivityInput): GamificationSummary {
  const measurements = sumCapped(a.readingsByDay, DAILY_CAP.measurement) * POINTS.measurement;
  const checkIns = a.checkInDays.length * POINTS.checkIn;
  const tests = sumCapped(a.testsByDay, DAILY_CAP.test) * POINTS.test;
  const exercise = sumCapped(a.exerciseByDay, DAILY_CAP.exercise) * POINTS.exercise;
  const sleep = a.sleepDays.length * POINTS.sleep;
  const bonus = a.screenings * POINTS.screening + a.fitnessChecks * POINTS.fitness;
  const points = measurements + checkIns + tests + exercise + sleep + bonus;

  const todayPoints =
    Math.min(a.readingsByDay[a.today] ?? 0, DAILY_CAP.measurement) * POINTS.measurement +
    (a.checkInDays.includes(a.today) ? POINTS.checkIn : 0) +
    Math.min(a.testsByDay[a.today] ?? 0, DAILY_CAP.test) * POINTS.test +
    Math.min(a.exerciseByDay[a.today] ?? 0, DAILY_CAP.exercise) * POINTS.exercise +
    (a.sleepDays.includes(a.today) ? POINTS.sleep : 0);

  const streaks: Record<StreakId, number> = {
    checkIn: streakOf(a.checkInDays, a.today),
    measurement: streakOf(Object.keys(a.readingsByDay), a.today),
    exercise: streakOf(Object.keys(a.exerciseByDay), a.today),
    sleep: streakOf(a.sleepDays, a.today),
  };

  const totalReadings = Object.values(a.readingsByDay).reduce((x, y) => x + y, 0);
  const maxTestsDay = Math.max(0, ...Object.values(a.testsByDay));
  const b = (id: BadgeId, icon: string, current: number, target: number): Badge => ({ id, icon, current: Math.min(current, target), target, unlocked: current >= target });
  const badges: Badge[] = [
    b('firstMeasurement', 'pulse', totalReadings, 1),
    b('tenMeasurements', 'stats-chart', totalReadings, 10),
    b('camera', 'camera', a.cameraReadings, 1),
    b('checkIn7', 'flame', streaks.checkIn, 7),
    b('checkIn30', 'calendar', a.checkInDays.length, 30),
    b('exercise5', 'barbell', Object.keys(a.exerciseByDay).length, 5),
    b('sleep7', 'moon', a.sleepDays.length, 7),
    b('allTests', 'flash', maxTestsDay, 4),
    b('screening', 'chatbubbles', a.screenings, 1),
    b('fitCheck', 'speedometer', a.fitnessChecks, 1),
  ];

  return {
    points,
    level: Math.floor(points / LEVEL_SIZE) + 1,
    levelProgress: points % LEVEL_SIZE,
    levelSize: LEVEL_SIZE,
    todayPoints,
    streaks,
    badges,
    breakdown: { measurements, checkIns, tests, exercise, sleep, bonus },
  };
}
