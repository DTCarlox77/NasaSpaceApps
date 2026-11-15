import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Streak } from '@/domain/entities/Wellbeing';
import { todayKey } from './routineStore';

export const SYMPTOMS = ['headache', 'nausea', 'congestion', 'backPain', 'blurredVision', 'insomnia', 'fatigue', 'none'] as const;
export type Symptom = (typeof SYMPTOMS)[number];

/**
 * Check-in diario de bienestar (confidencial). Los deslizadores van de 0 a 100 por dentro y NUNCA se
 * muestran como número, color ni semáforo: al astronauta solo se le muestra el mensaje neutro del servidor
 * y la racha. Los valores se guardan solo para precargar la corrección del día.
 */
export interface CheckIn {
  day: string; // YYYY-MM-DD
  createdAt: string;
  mood?: number;
  fatigue?: number;
  stress?: number;
  crewConflict?: number;
  sleepHours?: number | null;
  symptoms: Symptom[];
  note?: string;
  clientUuid?: string;
  /** 'sent' = el servidor lo recibió · 'queued' = en la cola · 'local' = modo demo. */
  state?: 'sent' | 'queued' | 'local';
  /** Mensaje neutro del servidor, tal cual. */
  message?: string;
  streak?: Streak | null;
  screeningDue?: boolean;
  /** true = corrigió el check-in anterior del mismo día. */
  corrected?: boolean;
}

interface CheckInState {
  /** Por usuario → por día. */
  entries: Record<string, Record<string, CheckIn>>;
  save: (userId: string, entry: Omit<CheckIn, 'day' | 'createdAt'>) => CheckIn;
  /** Respuesta del servidor para un check-in que estaba en la cola (push). */
  applyAck: (clientUuid: string, p: Pick<CheckIn, 'message' | 'streak' | 'screeningDue'>) => void;
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
      applyAck: (clientUuid, p) =>
        set((s) => ({
          entries: Object.fromEntries(
            Object.entries(s.entries).map(([uid, byDay]) => [
              uid,
              Object.fromEntries(Object.entries(byDay).map(([d, c]) => [d, c.clientUuid === clientUuid ? { ...c, ...p, state: 'sent' as const } : c])),
            ]),
          ),
        })),
    }),
    {
      name: 'nullradt-checkins',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      // v1 guardaba escalas 1–5 y "energía": se conservan solo el día y la nota (sin valores ni señales).
      migrate: (persisted) => {
        const old = (persisted as { entries?: Record<string, Record<string, { day: string; createdAt: string; note?: string }>> }) ?? {};
        const entries: CheckInState['entries'] = {};
        for (const [uid, byDay] of Object.entries(old.entries ?? {})) {
          entries[uid] = Object.fromEntries(
            Object.entries(byDay).map(([d, c]) => [d, { day: c.day, createdAt: c.createdAt, note: c.note, symptoms: [], state: 'local' as const }]),
          );
        }
        return { entries } as unknown as CheckInState;
      },
    },
  ),
);

/** Días consecutivos con check (hasta hoy, o hasta ayer si hoy aún no se hace). Solo modo demo. */
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
