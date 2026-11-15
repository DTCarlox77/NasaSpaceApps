import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { PROTOCOL, type Answers } from '@/domain/triage/evaluator';

export type TriageTrigger = 'manual' | 'criticalReading' | 'missedCheckIn' | 'crewEvent' | 'deadMan' | 'deviceEmergency' | 'sos';

export interface TriagePatient {
  crewId: string;
  answers: Answers;
  /** Descripción libre de lo que queda fuera del protocolo (se envía a Tierra). */
  outOfProtocol?: string;
  updatedAt: string;
}

export interface TriageReport {
  messageId: string;
  sentAt: number;
  auto: boolean;
}

export interface TriageIncident {
  id: string;
  protocolVersion: string;
  trigger: TriageTrigger;
  /** Quién activó: id de usuario o "device:<id>" en emergencia sin sesión. */
  activatedBy: string;
  startedAt: string;
  patients: Record<string, TriagePatient>;
  reports: TriageReport[];
  closedAt?: string;
}

interface TriageState {
  active: TriageIncident | null;
  history: TriageIncident[];
  start: (trigger: TriageTrigger, activatedBy: string) => TriageIncident;
  answer: (crewId: string, nodeId: string, value: boolean) => void;
  undo: (crewId: string, nodeId: string) => void;
  resetPatient: (crewId: string) => void;
  setOutOfProtocol: (crewId: string, text: string) => void;
  addReport: (r: TriageReport) => void;
  close: () => void;
}

const patient = (crewId: string, prev?: TriagePatient): TriagePatient => prev ?? { crewId, answers: {}, updatedAt: new Date().toISOString() };

export const useTriageStore = create<TriageState>()(
  persist(
    (set, get) => ({
      active: null,
      history: [],
      start: (trigger, activatedBy) => {
        const current = get().active;
        if (current) return current;
        const incident: TriageIncident = {
          id: `TRI-${Date.now().toString(36).toUpperCase()}`,
          protocolVersion: `${PROTOCOL.id}@${PROTOCOL.version}`,
          trigger,
          activatedBy,
          startedAt: new Date().toISOString(),
          patients: {},
          reports: [],
        };
        set({ active: incident });
        return incident;
      },
      answer: (crewId, nodeId, value) =>
        set((s) => {
          if (!s.active) return s;
          const p = patient(crewId, s.active.patients[crewId]);
          return {
            active: { ...s.active, patients: { ...s.active.patients, [crewId]: { ...p, answers: { ...p.answers, [nodeId]: value }, updatedAt: new Date().toISOString() } } },
          };
        }),
      undo: (crewId, nodeId) =>
        set((s) => {
          if (!s.active?.patients[crewId]) return s;
          const p = s.active.patients[crewId]!;
          const answers = { ...p.answers };
          delete answers[nodeId];
          return { active: { ...s.active, patients: { ...s.active.patients, [crewId]: { ...p, answers, updatedAt: new Date().toISOString() } } } };
        }),
      resetPatient: (crewId) =>
        set((s) => {
          if (!s.active) return s;
          const patients = { ...s.active.patients };
          delete patients[crewId];
          return { active: { ...s.active, patients } };
        }),
      setOutOfProtocol: (crewId, text) =>
        set((s) => {
          if (!s.active) return s;
          const p = patient(crewId, s.active.patients[crewId]);
          return { active: { ...s.active, patients: { ...s.active.patients, [crewId]: { ...p, outOfProtocol: text, updatedAt: new Date().toISOString() } } } };
        }),
      addReport: (r) => set((s) => (s.active ? { active: { ...s.active, reports: [...s.active.reports, r] } } : s)),
      close: () =>
        set((s) => (s.active ? { active: null, history: [{ ...s.active, closedAt: new Date().toISOString() }, ...s.history].slice(0, 20) } : s)),
    }),
    { name: 'nullradt-triage', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

/** Emergencia en curso: habilita el acceso de emergencia a datos (filtro de confidencialidad). */
export const isEmergencyActive = () => !!useTriageStore.getState().active;
