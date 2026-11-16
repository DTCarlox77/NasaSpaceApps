import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type RoutineCategory = 'health' | 'exercise' | 'nutrition' | 'rest' | 'work';

export interface RoutineItem {
  id: string;
  /** "HH:MM" hora local de la estación. */
  time: string;
  category: RoutineCategory;
  icon: string;
  /** Minutos de duración (informativo). */
  minutes: number;
  /** Tarea crítica: exige 'apto' en la prueba de reacción del día. */
  critical?: boolean;
}

/**
 * Rutina diaria sintética inspirada en el día típico en la EEI
 * (≈ 2 h de ejercicio diario para contrarrestar la pérdida ósea y muscular — NASA).
 * Las claves de texto viven en i18n: `routine.items.<id>`.
 */
export const ROUTINE: RoutineItem[] = [
  { id: 'wake', time: '06:00', category: 'rest', icon: 'sunny-outline', minutes: 30 },
  { id: 'dailyCheck', time: '06:30', category: 'health', icon: 'heart-outline', minutes: 5 },
  { id: 'vitals', time: '07:00', category: 'health', icon: 'pulse-outline', minutes: 10 },
  { id: 'breakfast', time: '07:30', category: 'nutrition', icon: 'cafe-outline', minutes: 30 },
  { id: 'hydration1', time: '09:30', category: 'nutrition', icon: 'water-outline', minutes: 2 },
  { id: 'aerobic', time: '10:00', category: 'exercise', icon: 'bicycle-outline', minutes: 60 },
  { id: 'lunch', time: '12:30', category: 'nutrition', icon: 'restaurant-outline', minutes: 45 },
  { id: 'fitCheck', time: '13:15', category: 'health', icon: 'speedometer-outline', minutes: 3 },
  { id: 'criticalTask', time: '13:30', category: 'work', icon: 'construct-outline', minutes: 90, critical: true },
  { id: 'hydration2', time: '14:30', category: 'nutrition', icon: 'water-outline', minutes: 2 },
  { id: 'resistance', time: '16:00', category: 'exercise', icon: 'barbell-outline', minutes: 60 },
  { id: 'eyes', time: '18:00', category: 'health', icon: 'eye-outline', minutes: 5 },
  { id: 'brainTests', time: '18:15', category: 'health', icon: 'flash-outline', minutes: 6 },
  { id: 'dinner', time: '19:00', category: 'nutrition', icon: 'restaurant-outline', minutes: 45 },
  { id: 'winddown', time: '21:00', category: 'rest', icon: 'moon-outline', minutes: 30 },
  { id: 'sleep', time: '21:30', category: 'rest', icon: 'bed-outline', minutes: 510 },
];

export const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

interface RoutineState {
  /** ids completados por día ("YYYY-MM-DD"). */
  done: Record<string, string[]>;
  /** id de rutina → id de la notificación programada. */
  reminders: Record<string, string>;
  toggleDone: (itemId: string, day?: string) => void;
  setReminder: (itemId: string, notificationId: string | null) => void;
}

export const useRoutineStore = create<RoutineState>()(
  persist(
    (set) => ({
      done: {},
      reminders: {},
      toggleDone: (itemId, day = todayKey()) =>
        set((s) => {
          const list = s.done[day] ?? [];
          return { done: { ...s.done, [day]: list.includes(itemId) ? list.filter((i) => i !== itemId) : [...list, itemId] } };
        }),
      setReminder: (itemId, notificationId) =>
        set((s) => {
          const next = { ...s.reminders };
          if (notificationId) next[itemId] = notificationId;
          else delete next[itemId];
          return { reminders: next };
        }),
    }),
    { name: 'nullradt-routine', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
