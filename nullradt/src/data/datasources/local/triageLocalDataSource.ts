import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EarthQuestion, LocalAssessment, LocalTriageSession, StoredProtocol } from '@/domain/entities/Triage';
import fallbackJson from './fallback/triage-protocol-v2.json';

/**
 * Triaje en el dispositivo (AsyncStorage, igual que la cola):
 * - Protocolos por versión (GET /emergency/protocol) para evaluar sin conexión.
 * - Sesiones, evaluaciones y preguntas a Tierra hechas en este dispositivo (sobreviven a reinicios).
 * Las escrituras se serializan para que dos guardados seguidos no se pisen.
 */
const PROTOCOLS_KEY = 'nullradt-triage-protocols-v1';
const STATE_KEY = 'nullradt-triage-state-v1';

interface ProtocolStore {
  /** Versión activa según el servidor (la última que bajó sin `?version`). */
  active: number | null;
  byVersion: Record<string, StoredProtocol>;
}

interface TriageState {
  sessions: Record<string, LocalTriageSession>;
  assessments: LocalAssessment[];
  questions: EarthQuestion[];
}

/** Copia de respaldo empaquetada (seed v2 del backend): solo si nunca se pudo bajar el protocolo. */
export const FALLBACK_PROTOCOL: StoredProtocol = {
  code: fallbackJson.code,
  version: fallbackJson.version,
  name: fallbackJson.name,
  definition: fallbackJson.definition as unknown as StoredProtocol['definition'],
  sources: fallbackJson.sources,
  origin: 'fallback',
  fetchedAt: null,
};

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

async function read<T>(key: string, empty: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? ({ ...empty, ...JSON.parse(raw) } as T) : empty;
  } catch {
    return empty;
  }
}

const emptyState = (): TriageState => ({ sessions: {}, assessments: [], questions: [] });
const readState = () => read<TriageState>(STATE_KEY, emptyState());
const writeState = (s: TriageState) => AsyncStorage.setItem(STATE_KEY, JSON.stringify(s));
const MAX_ASSESSMENTS = 200;
const MAX_QUESTIONS = 100;

export const triageLocalDataSource = {
  // ---------------------------------------------------------------- protocolos
  async getProtocols(): Promise<ProtocolStore> {
    return read<ProtocolStore>(PROTOCOLS_KEY, { active: null, byVersion: {} });
  },
  saveProtocol(protocol: StoredProtocol, active: boolean): Promise<void> {
    return serialized(async () => {
      const store = await read<ProtocolStore>(PROTOCOLS_KEY, { active: null, byVersion: {} });
      store.byVersion[String(protocol.version)] = protocol;
      if (active) store.active = protocol.version;
      await AsyncStorage.setItem(PROTOCOLS_KEY, JSON.stringify(store));
    });
  },

  // ---------------------------------------------------------------- sesiones
  async getSession(ref: string): Promise<LocalTriageSession | null> {
    const s = await readState();
    return s.sessions[ref] ?? Object.values(s.sessions).find((x) => x.serverId === ref || x.clientUuid === ref) ?? null;
  },
  saveSession(session: LocalTriageSession): Promise<void> {
    return serialized(async () => {
      const s = await readState();
      s.sessions[session.ref] = session;
      await writeState(s);
    });
  },
  /** Actualiza la sesión con ese ref (o cuyo server id / client_uuid coincide). */
  updateSession(ref: string, patch: (s: LocalTriageSession) => LocalTriageSession): Promise<LocalTriageSession | null> {
    return serialized(async () => {
      const s = await readState();
      const key = s.sessions[ref] ? ref : Object.keys(s.sessions).find((k) => s.sessions[k]!.serverId === ref || s.sessions[k]!.clientUuid === ref);
      if (!key) return null;
      const next = patch(s.sessions[key]!);
      s.sessions[key] = next;
      await writeState(s);
      return next;
    });
  },

  // ---------------------------------------------------------------- evaluaciones
  async assessmentsOf(sessionRef: string): Promise<LocalAssessment[]> {
    return (await readState()).assessments.filter((a) => a.sessionRef === sessionRef);
  },
  async getAssessment(clientUuid: string): Promise<LocalAssessment | null> {
    return (await readState()).assessments.find((a) => a.clientUuid === clientUuid) ?? null;
  },
  saveAssessment(assessment: LocalAssessment): Promise<void> {
    return serialized(async () => {
      const s = await readState();
      const i = s.assessments.findIndex((a) => a.clientUuid === assessment.clientUuid);
      if (i >= 0) s.assessments[i] = assessment;
      else s.assessments.push(assessment);
      s.assessments = s.assessments.slice(-MAX_ASSESSMENTS);
      await writeState(s);
    });
  },
  updateAssessment(clientUuid: string, patch: (a: LocalAssessment) => LocalAssessment): Promise<LocalAssessment | null> {
    return serialized(async () => {
      const s = await readState();
      const i = s.assessments.findIndex((a) => a.clientUuid === clientUuid);
      if (i < 0) return null;
      const next = patch(s.assessments[i]!);
      s.assessments[i] = next;
      await writeState(s);
      return next;
    });
  },

  // ---------------------------------------------------------------- preguntas a Tierra
  async questionsOf(sessionRef: string): Promise<EarthQuestion[]> {
    return (await readState()).questions.filter((q) => q.sessionRef === sessionRef);
  },
  updateQuestion(clientUuid: string, patch: (q: EarthQuestion) => EarthQuestion): Promise<EarthQuestion | null> {
    return serialized(async () => {
      const s = await readState();
      const i = s.questions.findIndex((q) => q.clientUuid === clientUuid);
      if (i < 0) return null;
      const next = patch(s.questions[i]!);
      s.questions[i] = next;
      await writeState(s);
      return next;
    });
  },
  saveQuestion(question: EarthQuestion): Promise<void> {
    return serialized(async () => {
      const s = await readState();
      const i = s.questions.findIndex((q) => q.clientUuid === question.clientUuid);
      if (i >= 0) s.questions[i] = question;
      else s.questions.push(question);
      s.questions = s.questions.slice(-MAX_QUESTIONS);
      await writeState(s);
    });
  },

  /** Al cerrar sesión: las evaluaciones son datos de salud de la tripulación. Los protocolos se quedan. */
  async clear() {
    await AsyncStorage.removeItem(STATE_KEY).catch(() => {});
  },
};
