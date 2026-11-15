import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { HealthIndicator, HealthStatus, IndicatorId, Reading } from '@/domain/entities/HealthIndicator';

/** Lectura tomada en el dispositivo. */
export interface LocalReading {
  indicatorId: IndicatorId;
  reading: Reading;
  status: HealthStatus;
  /** client_uuid con el que se envió (o se encoló) al servidor. */
  clientUuid?: string;
  /** Recomendación del servidor (tal cual). */
  recommendation?: string | null;
}

/** Alerta enviada / recibida por la tripulación (simulada en el modo demo, sin backend). */
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
  /** Resultado del servidor para una lectura encolada (push o pull): deja de estar "sin evaluar". */
  applyEvaluation: (clientUuid: string, status: HealthStatus, recommendation?: string | null) => void;
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
      applyEvaluation: (clientUuid, status, recommendation) =>
        set((s) => {
          let changed = false;
          const readings = Object.fromEntries(
            Object.entries(s.readings).map(([uid, list]) => [
              uid,
              list.map((l) => {
                if (l.clientUuid !== clientUuid) return l;
                changed = true;
                return { ...l, status, recommendation: recommendation ?? l.recommendation, reading: { ...l.reading, synced: true } };
              }),
            ]),
          );
          return changed ? { readings } : s;
        }),
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

/**
 * Aplica las mediciones locales sobre los indicadores.
 * - Maqueta (demo): la más reciente manda y se agrega a la tendencia.
 * - Servidor/caché: el servidor ya tiene lo sincronizado; solo se agregan las lecturas MÁS NUEVAS que su
 *   último valor (p. ej. las que esperan en la cola, "sin evaluar" hasta que el servidor responda).
 */
export function applyLocalReadings(indicators: HealthIndicator[], local: LocalReading[] = [], fromServer = false): HealthIndicator[] {
  if (!local.length) return indicators;
  return indicators.map((ind) => {
    const latestAt = ind.latest ? new Date(ind.latest.takenAt).getTime() : 0;
    const mine = local.filter(
      (l) => l.indicatorId === ind.id && (!fromServer || new Date(l.reading.takenAt).getTime() > latestAt),
    );
    if (!mine.length) return ind;
    const last = mine[mine.length - 1]!;
    return {
      ...ind,
      latest: last.reading,
      status: last.status,
      recommendation: last.recommendation ?? (fromServer ? null : ind.recommendation),
      trend: [...ind.trend, ...mine.map((m) => m.reading.value)].slice(-10),
    };
  });
}
