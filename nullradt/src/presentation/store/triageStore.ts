import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Emergencia en curso en ESTE dispositivo (solo el indicador; el triaje real vive en
 * `/triage/[sessionId]` con el protocolo del servidor, ver INTEGRACION.md §10).
 * Lo usan la cabecera (SOS vuelve al triaje abierto), la visibilidad en emergencia y Tripulación.
 */
export interface ActiveEmergency {
  /** Id de la sesión del servidor, o el client_uuid si quedó en cola / modo demo. */
  ref: string;
  startedAt: string;
}

interface TriageState {
  active: ActiveEmergency | null;
  start: (ref: string) => void;
  close: () => void;
}

export const useTriageStore = create<TriageState>()(
  persist(
    (set, get) => ({
      active: null,
      start: (ref) => {
        if (get().active?.ref !== ref) set({ active: { ref, startedAt: new Date().toISOString() } });
      },
      close: () => set({ active: null }),
    }),
    { name: 'nullradt-emergency-active-v2', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export const isEmergencyActive = () => !!useTriageStore.getState().active;
