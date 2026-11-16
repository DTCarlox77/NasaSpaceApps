import { create } from 'zustand';
import type { AppNotification } from '@/core/notifications/notificationService';

export interface Toast extends AppNotification {
  id: string;
  /** Tiempo visible en ms (la barra de progreso se vacía en este tiempo). */
  duration: number;
}

interface ToastState {
  queue: Toast[];
  show: (n: AppNotification & { duration?: number }) => void;
  dismiss: (id: string) => void;
}

const DEFAULT_DURATION: Record<AppNotification['level'], number> = {
  info: 4000,
  normal: 4000,
  caution: 6000,
  critical: 8000,
};

/** Cola de avisos in-app: se muestra uno a la vez, en orden de llegada. */
export const useToastStore = create<ToastState>((set) => ({
  queue: [],
  show: (n) =>
    set((s) => ({
      queue: [
        ...s.queue,
        { ...n, id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, duration: n.duration ?? DEFAULT_DURATION[n.level] },
      ],
    })),
  dismiss: (id) => set((s) => ({ queue: s.queue.filter((t) => t.id !== id) })),
}));

/** Atajo para usar fuera de componentes. */
export const showToast = (n: AppNotification & { duration?: number }) => useToastStore.getState().show(n);
