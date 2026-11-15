import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { todayKey } from './routineStore';

/** PHQ-2 + GAD-2 (uso libre). Respuestas 0–3 por ítem. Confidencial. */
export interface Screening {
  day: string;
  createdAt: string;
  phq: [number, number];
  gad: [number, number];
  phqTotal: number;
  gadTotal: number;
  /** Positivo = PHQ-2 ≥ 3 o GAD-2 ≥ 3 → escalamiento confidencial a salud conductual. */
  positive: boolean;
  missionDay?: number;
}

/** Prueba de reacción inspirada en la PVT-B (3 min). El detalle es del astronauta; a Tierra solo va "apto / no confirmado". */
export interface FitnessCheck {
  createdAt: string;
  day: string;
  deviceId: string;
  durationSec: number;
  meanRt: number;
  /** Respuestas ≥ 355 ms (criterio de lapso de la PVT-B). */
  lapses: number;
  falseStarts: number;
  responses: number;
  /** baseline = aún construyendo la línea base personal (primeras 3 pruebas en este dispositivo). */
  fit: 'yes' | 'notConfirmed' | 'baseline';
}

interface WellbeingState {
  screenings: Record<string, Screening[]>;
  fitness: Record<string, FitnessCheck[]>;
  /** Compartir el bienestar con comandante / oficial médico a bordo. DESACTIVADO por defecto. */
  shareWithCrew: Record<string, boolean>;
  addScreening: (userId: string, s: Omit<Screening, 'day' | 'createdAt'>) => Screening;
  addFitness: (userId: string, f: Omit<FitnessCheck, 'day' | 'createdAt'>) => FitnessCheck;
  setShareWithCrew: (userId: string, on: boolean) => void;
}

export const useWellbeingStore = create<WellbeingState>()(
  persist(
    (set) => ({
      screenings: {},
      fitness: {},
      shareWithCrew: {},
      addScreening: (userId, s) => {
        const full: Screening = { ...s, day: todayKey(), createdAt: new Date().toISOString() };
        set((st) => ({ screenings: { ...st.screenings, [userId]: [...(st.screenings[userId] ?? []), full].slice(-60) } }));
        return full;
      },
      addFitness: (userId, f) => {
        const full: FitnessCheck = { ...f, day: todayKey(), createdAt: new Date().toISOString() };
        set((st) => ({ fitness: { ...st.fitness, [userId]: [...(st.fitness[userId] ?? []), full].slice(-120) } }));
        return full;
      },
      setShareWithCrew: (userId, on) => set((st) => ({ shareWithCrew: { ...st.shareWithCrew, [userId]: on } })),
    }),
    { name: 'nullradt-wellbeing', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

/** Última prueba de aptitud de hoy (para tareas críticas). */
export const fitnessToday = (list: FitnessCheck[] = []) => [...list].reverse().find((f) => f.day === todayKey());
