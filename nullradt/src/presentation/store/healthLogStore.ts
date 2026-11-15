import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { HealthIndicator, HealthStatus, IndicatorId, Reading } from '@/domain/entities/HealthIndicator';

/** Lectura tomada en el dispositivo (simulada en la demo). */
export interface LocalReading {
  indicatorId: IndicatorId;
  reading: Reading;
  status: HealthStatus;
}

/** Alerta enviada / recibida por la tripulación (simulada en la demo, sin backend). */
export interface CrewAlert {
  id: string;
  fromId: string;
  fromName: string;
  kind: 'measurement' | 'sos';
  indicatorId?: IndicatorId;
  value?: string;
  severity: 'caution' | 'critical';
  createdAt: string;
  cancelledAt?: string;
}

interface HealthLogState {
  /** Mediciones locales por usuario (las más recientes al final). */
  readings: Record<string, LocalReading[]>;
  alerts: CrewAlert[];
  addReading: (userId: string, r: LocalReading) => void;
  addAlert: (a: Omit<CrewAlert, 'id' | 'createdAt'>) => CrewAlert;
  cancelAlert: (id: string) => void;
}

export const useHealthLogStore = create<HealthLogState>()(
  persist(
    (set) => ({
      readings: {},
      alerts: [],
      addReading: (userId, r) =>
        set((s) => ({ readings: { ...s.readings, [userId]: [...(s.readings[userId] ?? []), r].slice(-120) } })),
      addAlert: (a) => {
        const alert: CrewAlert = { ...a, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date().toISOString() };
        set((s) => ({ alerts: [alert, ...s.alerts].slice(0, 50) }));
        return alert;
      },
      cancelAlert: (id) =>
        set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, cancelledAt: new Date().toISOString() } : a)) })),
    }),
    { name: 'nullradt-health-log', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

/** Aplica las mediciones locales sobre los indicadores (la más reciente manda y se agrega a la tendencia). */
export function applyLocalReadings(indicators: HealthIndicator[], local: LocalReading[] = []): HealthIndicator[] {
  if (!local.length) return indicators;
  return indicators.map((ind) => {
    const mine = local.filter((l) => l.indicatorId === ind.id);
    if (!mine.length) return ind;
    const last = mine[mine.length - 1]!;
    return {
      ...ind,
      latest: last.reading,
      status: last.status,
      trend: [...ind.trend, ...mine.map((m) => m.reading.value)].slice(-10),
    };
  });
}
