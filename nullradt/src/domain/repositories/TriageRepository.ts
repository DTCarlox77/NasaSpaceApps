import type { OutboxItem } from '../entities/Sync';
import type {
  EarthQuestion,
  LocalAnswer,
  LocalAssessment,
  LocalTriageSession,
  StoredProtocol,
  TriageRosterEntry,
  TriageSessionView,
} from '../entities/Triage';

/**
 * Triaje (guía §10). El dispositivo clasifica con el mismo evaluador que el servidor y el protocolo
 * guardado; el resultado del servidor manda cuando llega. Sin conexión todo va a la cola (prioridad
 * emergencia) con referencias por client_uuid.
 */
export interface TriageRepository {
  /** GET /emergency/protocol (activo o `version`) y lo guarda. null = sin conexión. */
  refreshProtocol(version?: number): Promise<StoredProtocol | null>;
  /**
   * Protocolo para evaluar: el de esa versión si está guardado (o, con `network`, si se puede bajar); si no, el
   * activo guardado o la copia de respaldo.
   */
  getProtocol(version?: number | null, opts?: { network?: boolean }): Promise<StoredProtocol>;
  /** Registra la sesión que abrió (o a la que se unió) la alerta, para usarla sin conexión. */
  rememberSession(session: LocalTriageSession): Promise<void>;
  /**
   * Estado de la sesión. `remote: false` = solo lo guardado en el dispositivo (instantáneo, sin red);
   * `remote: true` = además GET /emergency/sessions/{id} (si no responde, lo del dispositivo).
   */
  loadSession(
    ref: string,
    fallbackRoster: () => Promise<{ entries: TriageRosterEntry[]; source: TriageSessionView['rosterSource'] }>,
    opts: { remote: boolean },
  ): Promise<TriageSessionView | null>;
  /** responder_safe contestado en este dispositivo (se manda con las evaluaciones). */
  answerResponderSafe(ref: string, answer: LocalAnswer): Promise<void>;
  /** Empieza una evaluación nueva (reevaluar = otra nueva) solo en el dispositivo. */
  startAssessment(ref: string, member: TriageRosterEntry, protocolVersion: number): Promise<LocalAssessment>;
  getAssessment(clientUuid: string): Promise<LocalAssessment | null>;
  saveAnswers(clientUuid: string, answers: LocalAnswer[]): Promise<LocalAssessment | null>;
  /** POST assessments → PUT answers → POST complete con device_result, o a la cola si no hay enlace. */
  completeAssessment(clientUuid: string): Promise<LocalAssessment>;
  /** POST /emergency/sessions/{id}/heartbeat (sin conexión: un solo latido en cola por sesión). */
  heartbeat(ref: string): Promise<'sent' | 'queued' | 'skipped'>;
  /** POST /emergency/sessions/{id}/questions. */
  askEarth(ref: string, body: string): Promise<EarthQuestion>;
  /** Aplica a lo guardado lo que respondió el servidor a un item de la cola. */
  applyPushResult(item: OutboxItem, status: string, result: Record<string, unknown> | null): Promise<boolean>;
  /** Marca la sesión como cerrada en el dispositivo. */
  markClosed(ref: string, status: 'closed' | 'cancelled'): Promise<void>;
}
