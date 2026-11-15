import { useEffect } from 'react';
import { create } from 'zustand';
import { registerBackgroundMonitor, type MonitorState } from '@/presentation/background/monitorTask';

export const useMonitorStore = create<{ state: MonitorState | null }>(() => ({ state: null }));

/** Registra el monitoreo en segundo plano al iniciar y publica su estado para Ajustes. */
export function useBackgroundMonitor() {
  useEffect(() => {
    registerBackgroundMonitor().then((state) => useMonitorStore.setState({ state }));
  }, []);
}
