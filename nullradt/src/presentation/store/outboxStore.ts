import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { computeDeliverAt, LINK_PROFILES, type LinkProfileId } from '@/domain/comms/linkModel';

/**
 * Bandeja de mensajes entre la nave y Tierra (servidor a bordo → réplica en Tierra con retraso).
 * En la demo todo corre en el dispositivo: el "envío" calcula `deliverAt` con el modelo de enlace.
 */
export type Audience = 'flightSurgeon' | 'behavioralHealth' | 'missionControl';
export type OutboxKind = 'triageReport' | 'escalation' | 'screening' | 'talkRequest' | 'fitness' | 'audit' | 'emergency' | 'reply';
export type MessageStatus = 'queued' | 'inTransit' | 'delivered';

export interface OutboxMessage {
  id: string;
  kind: OutboxKind;
  /** toEarth = de la nave a Tierra · toCrew = respuesta de Tierra. */
  direction: 'toEarth' | 'toCrew';
  audience: Audience;
  fromId: string;
  /** Tripulante al que se refiere (para el filtro de quién ve qué). */
  subjectId?: string;
  title: string;
  body: string;
  /** Confidencial = solo salud conductual / el propio astronauta (nunca la tripulación). */
  confidential: boolean;
  createdAt: number;
  /** null = en cola (enlace desconectado a mano). */
  deliverAt: number | null;
  /** Hilo (p. ej. conversación con salud conductual). */
  threadId?: string;
  synthetic?: boolean;
}

interface OutboxState {
  messages: OutboxMessage[];
  profile: LinkProfileId;
  forcedOffline: boolean;
  send: (m: Omit<OutboxMessage, 'id' | 'createdAt' | 'deliverAt' | 'direction'> & { direction?: OutboxMessage['direction']; createdAt?: number }) => OutboxMessage;
  setProfile: (p: LinkProfileId) => void;
  setForcedOffline: (off: boolean) => void;
  clearDelivered: () => void;
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const useOutboxStore = create<OutboxState>()(
  persist(
    (set, get) => ({
      messages: [],
      profile: 'demo',
      forcedOffline: false,
      send: (m) => {
        const { profile, forcedOffline } = get();
        const createdAt = m.createdAt ?? Date.now();
        const msg: OutboxMessage = {
          direction: 'toEarth',
          ...m,
          id: newId(),
          createdAt,
          deliverAt: computeDeliverAt(createdAt, LINK_PROFILES[profile], forcedOffline),
        };
        set((s) => ({ messages: [msg, ...s.messages].slice(0, 200) }));
        return msg;
      },
      setProfile: (profile) => set({ profile }),
      setForcedOffline: (forcedOffline) =>
        set((s) => {
          if (forcedOffline) return { forcedOffline };
          // Al reconectar, lo que estaba en cola sale ahora.
          const now = Date.now();
          const p = LINK_PROFILES[s.profile];
          return {
            forcedOffline,
            messages: s.messages.map((m) => (m.deliverAt === null ? { ...m, deliverAt: computeDeliverAt(Math.max(now, m.createdAt), p) } : m)),
          };
        }),
      clearDelivered: () => set((s) => ({ messages: s.messages.filter((m) => m.deliverAt === null || m.deliverAt > Date.now()) })),
    }),
    { name: 'nullradt-outbox', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export function messageStatus(m: OutboxMessage, now = Date.now()): MessageStatus {
  if (m.deliverAt === null) return 'queued';
  return now >= m.deliverAt ? 'delivered' : 'inTransit';
}

/** Mensajes que ya llegaron a su destino (lo que Tierra "ve" en este momento). */
export const deliveredFor = (messages: OutboxMessage[], audience: Audience, now = Date.now()) =>
  messages.filter((m) => m.audience === audience && m.direction === 'toEarth' && messageStatus(m, now) === 'delivered');

/** Atajo: enviar a Tierra desde código no-React. */
export const sendToEarth = (m: Parameters<OutboxState['send']>[0]) => useOutboxStore.getState().send(m);
