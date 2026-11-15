import type { TriageDefinition, TriageQuestion } from '@/core/engine/triage';

export type { TriageDefinition, TriageQuestion };

/** Categoría START del protocolo. */
export type TriageCategory = 'green' | 'yellow' | 'red' | 'black';
export type RadiationFlag = 'none' | 'possible' | 'probable';

/** Respuesta con el formato del contrato: `{ value }` (sí/no, número) o `{ choice }` (una o varias opciones). */
export type TriageAnswer = { value: boolean | number } | { choice: string | string[] };

/** Cómo se respondió (`AnswerSource` del contrato). */
export type AnswerSource = 'tap' | 'voice' | 'prefill' | 'auto';

/** Protocolo guardado para usarlo sin conexión. */
export interface StoredProtocol {
  code: string;
  version: number;
  name: string;
  definition: TriageDefinition;
  sources: { id: string; title: string; url: string; publisher?: string }[];
  /** server = GET /emergency/protocol · fallback = copia de respaldo empaquetada (seed v2 del backend). */
  origin: 'server' | 'fallback';
  fetchedAt: string | null;
}

export interface LocalAnswer {
  clientUuid: string;
  questionCode: string;
  answer: TriageAnswer;
  source: AnswerSource;
  answeredAt: string;
}

/** Lo que calculó la tableta (`device_result` del complete). */
export interface DeviceResult {
  status: 'completed' | 'incomplete' | 'stopped';
  triage_category?: TriageCategory;
  radiation_flag?: RadiationFlag;
  rules_version: number;
}

/** Aviso que generó una evaluación (`EscalationAction`): a bordo o a Tierra, con su hora de llegada. */
export interface TriageEscalation {
  level: string;
  priority: string;
  escalationId: string | null;
  /** null = en cola esperando enlace. */
  deliverAt: string | null;
}

/** Resultado del servidor al completar (siempre manda). */
export interface ServerAssessmentResult {
  status: 'completed' | 'incomplete' | 'stopped';
  triageCategory: TriageCategory | null;
  radiationFlag: RadiationFlag | null;
  rulesVersion: number | null;
  matchesDevice: boolean | null;
  mismatchFields: string[];
  escalations: TriageEscalation[];
  receivedAt: string;
}

/** Evaluación de un tripulante hecha en este dispositivo. */
export interface LocalAssessment {
  clientUuid: string;
  sessionRef: string;
  astronautId: string;
  callSign: string;
  startedAt: string;
  completedAt: string | null;
  protocolVersion: number;
  answers: LocalAnswer[];
  device: DeviceResult | null;
  server: ServerAssessmentResult | null;
  /** draft = respondiendo · sent = el servidor ya respondió · queued = en la cola (sin enlace) · local = modo demo. */
  delivery: 'draft' | 'sent' | 'queued' | 'local';
  serverId: string | null;
  error: string | null;
}

/** Pregunta a Tierra (POST /emergency/sessions/{id}/questions). */
export interface EarthQuestion {
  clientUuid: string;
  sessionRef: string;
  body: string;
  askedAt: string;
  /** null = sin enlace (en cola o el servidor la retiene por un corte). */
  deliverAt: string | null;
  delivery: 'sent' | 'queued';
}

export type TriageSessionStatus = 'pending' | 'active' | 'closed' | 'cancelled' | 'merged' | 'queued' | 'demo';

/** Sesión conocida por este dispositivo (la abrió o se unió desde la alerta). */
export interface LocalTriageSession {
  /** Id de la ruta: id del servidor o el client_uuid (sesión creada sin conexión). */
  ref: string;
  serverId: string | null;
  clientUuid: string | null;
  status: TriageSessionStatus;
  startedAt: string;
  context: Record<string, unknown>;
  responderSafe: boolean | null;
  /** responder_safe contestado en este dispositivo después de abrir (se manda con las evaluaciones). */
  responderSafeAnswer: LocalAnswer | null;
  protocolVersion: number | null;
  missionCode?: string;
  joined: boolean;
  mergedInto: string | null;
  /** Modo demo sin servidor: todo queda en el dispositivo. */
  demo: boolean;
}

export interface TriageRosterEntry {
  astronautId: string;
  callSign: string;
  crewRole: string | null;
  sequenceNo: number;
  priorityReason: string | null;
}

/** Fila del orden de atención (`AttentionEntry`); `reason` solo viene del servidor. */
export interface AttentionRow {
  position: number;
  astronautId: string;
  callSign: string;
  status: 'assessed' | 'in_progress' | 'unassessed';
  triageCategory: TriageCategory | null;
  radiationFlag: RadiationFlag | null;
  matchesDevice: boolean | null;
  reason: string | null;
}

/** Evaluación vigente de un tripulante (la del servidor o, sin conexión, la de la tableta). */
export interface CurrentAssessment {
  astronautId: string;
  status: 'completed' | 'in_progress';
  triageCategory: TriageCategory | null;
  radiationFlag: RadiationFlag | null;
  /** server = clasificación del servidor · device = solo la tableta (pendiente de confirmar). */
  computedBy: 'server' | 'device';
  matchesDevice: boolean | null;
  completedAt: string | null;
  local: LocalAssessment | null;
}

export interface TriageSessionView {
  session: LocalTriageSession;
  /** true = se acaba de leer del servidor; false = datos del dispositivo (sin enlace). */
  fromServer: boolean;
  nextStep: 'start_assessments' | 'secure_self' | null;
  roster: TriageRosterEntry[];
  rosterSource: 'server' | 'crew' | 'demo' | 'none';
  attention: AttentionRow[];
  /** server = `attention_order` del servidor · device = calculado en la tableta con el protocolo. */
  attentionSource: 'server' | 'device';
  current: Record<string, CurrentAssessment>;
  questions: EarthQuestion[];
  heartbeatExpiresAt: string | null;
}
