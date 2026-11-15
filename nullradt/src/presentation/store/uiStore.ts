import { create } from 'zustand';
import type { BodySystemId } from '@/domain/entities/HealthIndicator';

/** Estado de UI compartido entre pestañas (p. ej. sistema elegido en Inicio → abrir en Monitor). */
interface UiState {
  selectedSystem: BodySystemId;
  setSelectedSystem: (id: BodySystemId) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedSystem: 'cardiovascular',
  setSelectedSystem: (selectedSystem) => set({ selectedSystem }),
}));
