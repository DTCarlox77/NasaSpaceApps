import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { SupportChannel, SupportSuggestion, SupportUrgency } from '@/domain/entities/Wellbeing';

/**
 * "Quiero hablar con alguien" (confidencial). Solo el propio astronauta ve sus solicitudes:
 * nadie de la tripulación las recibe.
 */
export interface SupportThread {
  clientUuid: string;
  /** id del servidor (thread_id de las respuestas). null mientras está en cola. */
  serverId: string | null;
  urgency: SupportUrgency;
  channel: SupportChannel;
  content: string;
  createdAt: string;
  /** 'queued' = en el dispositivo · 'sent' = el servidor la tiene · 'local' = modo demo. */
  state: 'queued' | 'sent' | 'local';
  /** Llegada a Tierra (null = esperando enlace). */
  deliverAt: string | null;
  suggestions: SupportSuggestion[];
  replies: { id: string; body: string; deliverAt: string }[];
}

interface SupportState {
  threads: Record<string, SupportThread[]>;
  add: (userId: string, t: SupportThread) => void;
  /** Resultado del servidor (en línea o por push). */
  markSent: (clientUuid: string, p: { serverId: string | null; deliverAt: string | null; suggestions?: SupportSuggestion[] }) => void;
  /** Respuestas de salud conductual que trajo el pull (`channel: support`, `thread_id` = id de la solicitud). */
  addReplies: (replies: { id: string; threadId: string; body: string; deliverAt: string }[]) => void;
}

export const useSupportStore = create<SupportState>()(
  persist(
    (set) => ({
      threads: {},
      add: (userId, t) => set((s) => ({ threads: { ...s.threads, [userId]: [t, ...(s.threads[userId] ?? [])].slice(0, 30) } })),
      markSent: (clientUuid, p) =>
        set((s) => ({
          threads: Object.fromEntries(
            Object.entries(s.threads).map(([uid, list]) => [
              uid,
              list.map((t) =>
                t.clientUuid === clientUuid
                  ? { ...t, state: 'sent' as const, serverId: p.serverId ?? t.serverId, deliverAt: p.deliverAt, suggestions: p.suggestions?.length ? p.suggestions : t.suggestions }
                  : t,
              ),
            ]),
          ),
        })),
      addReplies: (replies) =>
        set((s) => ({
          threads: Object.fromEntries(
            Object.entries(s.threads).map(([uid, list]) => [
              uid,
              list.map((t) => {
                const mine = replies.filter((r) => r.threadId === t.serverId && !t.replies.some((x) => x.id === r.id));
                return mine.length ? { ...t, replies: [...t.replies, ...mine.map(({ id, body, deliverAt }) => ({ id, body, deliverAt }))] } : t;
              }),
            ]),
          ),
        })),
    }),
    { name: 'nullradt-support', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
