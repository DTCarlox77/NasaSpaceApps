import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { DeliveredMessage } from '@/domain/entities/Sync';

/** Estado visible de la sincronización con el servidor. */
interface SyncState {
  syncing: boolean;
  /** Items en la cola local (sin subir). */
  pending: number;
  lastSyncAt: string | null;
  /** Enlace con Tierra según el último pull. */
  link: { status: 'up' | 'outage'; outageEndsAt: string | null; commDelaySeconds: number } | null;
  /** Mensajes de Tierra del canal `escalation` (respuestas del flight surgeon a tus alertas). */
  messages: DeliveredMessage[];
  /** Sube en cada sync con cambios: las pantallas recargan datos del servidor. */
  version: number;
  setSyncing: (syncing: boolean) => void;
  setPending: (pending: number) => void;
  finish: (p: { link?: SyncState['link']; messages?: DeliveredMessage[]; changed: boolean }) => void;
  bump: () => void;
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set) => ({
      syncing: false,
      pending: 0,
      lastSyncAt: null,
      link: null,
      messages: [],
      version: 0,
      setSyncing: (syncing) => set({ syncing }),
      setPending: (pending) => set({ pending }),
      finish: ({ link, messages = [], changed }) =>
        set((s) => {
          const known = new Set(s.messages.map((m) => m.id));
          return {
            lastSyncAt: new Date().toISOString(),
            link: link ?? s.link,
            messages: [...messages.filter((m) => !known.has(m.id)), ...s.messages].slice(0, 50),
            version: changed ? s.version + 1 : s.version,
          };
        }),
      bump: () => set((s) => ({ version: s.version + 1 })),
    }),
    {
      name: 'nullradt-sync',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ lastSyncAt, link, messages }) => ({ lastSyncAt, link, messages }),
    },
  ),
);
