import { create } from 'zustand';
import type Ionicons from '@expo/vector-icons/Ionicons';
import type { ButtonVariant } from '@/presentation/components/ui/Button';

export type DialogTone = 'info' | 'caution' | 'critical' | 'brand';

export interface DialogAction {
  label: string;
  variant?: ButtonVariant;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}

export interface DialogOptions {
  title: string;
  body?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: DialogTone;
  /** En orden visual (arriba → abajo). */
  actions: DialogAction[];
  /** Tocar fuera / botón atrás de Android = esta acción (por defecto, cerrar sin hacer nada). */
  dismissable?: boolean;
}

interface DialogState {
  current: DialogOptions | null;
  show: (d: DialogOptions) => void;
  close: () => void;
}

/** Diálogo con la identidad de la app (reemplaza Alert.alert nativo). Uno a la vez. */
export const useDialogStore = create<DialogState>((set) => ({
  current: null,
  show: (d) => set({ current: d }),
  close: () => set({ current: null }),
}));

export const showDialog = (d: DialogOptions) => useDialogStore.getState().show(d);
