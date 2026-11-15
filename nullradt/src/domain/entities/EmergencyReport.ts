/** Gravedad que el astronauta declara al enviar una alerta manual. */
export type ReportSeverity = 'caution' | 'critical';

/** Cómo se originó la alerta. */
export type ReportTrigger = 'shake' | 'manual' | 'rule';

export interface EmergencyReport {
  id: string;
  severity: ReportSeverity;
  trigger: ReportTrigger;
  /** ISO 8601, hora del dispositivo. */
  createdAt: string;
  language: 'es' | 'en';
  missionDay?: number;
  note?: string;
  /** ¿Quien activa está a salvo? (contrato: `responder_safe`). */
  responderSafe?: boolean;
  /**
   * Contexto de la sesión (`EmergencyContext.solar_event_active`): con evento solar el protocolo activa su
   * módulo de radiación. Lo declara quien abre la emergencia; el servidor no lo infiere en una apertura manual.
   */
  solarEventActive?: boolean;
  /** Toda la demo usa datos sintéticos. */
  synthetic: boolean;
}

/** Estado de una sesión de emergencia del servidor (POST /emergency/sessions). */
export interface EmergencySessionInfo {
  id: string;
  status: 'pending' | 'active' | 'closed' | 'cancelled' | 'merged';
  /** true = ya había una emergencia abierta en la misión y te uniste a ella. */
  joined: boolean;
  /** 'secure_self' = mostrar "ponte a salvo" antes de evaluar. */
  nextStep: 'start_assessments' | 'secure_self' | null;
  startedAt: string;
  missionCode?: string;
  /** Tripulantes de la sesión (call signs del roster, ordenado por riesgo por el servidor). */
  roster: string[];
}

export type DeliveryResult =
  /** El servidor abrió (o te unió a) una sesión de emergencia. */
  | { status: 'sent'; report: EmergencyReport; session: EmergencySessionInfo | null }
  /** Sin conexión o API caída: queda en cola local (prioridad emergencia) y se reintenta antes que todo. */
  | { status: 'queued'; report: EmergencyReport; reason: string }
  /**
   * Solo en el dispositivo: modo demo sin servidor, o una alerta de PRECAUCIÓN
   * (no es una emergencia y el contrato no tiene endpoint para ella).
   */
  | { status: 'local'; report: EmergencyReport };

/** Resultado de "Estoy bien" (POST /emergency/sessions/{id}/confirm). */
export type ConfirmOkOutcome = 'confirmed' | 'expired' | 'queued';
