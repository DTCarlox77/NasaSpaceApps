import type { EscalationLevel, HealthStatus, IndicatorId } from './HealthIndicator';

/** Lectura que el astronauta registra en la app (POST /readings o cola de sync). */
export interface ReadingInput {
  indicatorId: IndicatorId;
  /** Valor principal (o sistólica en presión arterial). */
  value?: number;
  /** Diastólica en presión arterial. */
  secondaryValue?: number;
  /** Códigos del catálogo de síntomas (GET /symptoms) para la lectura SYMPTOM. */
  symptoms?: string[];
  /** Cómo se tomó en la app; el repositorio lo ajusta a `input_methods` del catálogo. */
  source: 'wearable' | 'manual';
  takenAt: string; // ISO 8601, hora del dispositivo
}

/** Activación automática de emergencia que devolvió la lectura (mostrar "¿Estás bien?"). */
export interface AutoEmergency {
  sessionId: string;
  status: string;
  deadlineAt: string | null;
}

export type ReadingOutcome =
  /** El servidor la guardó y la evaluó: se muestra su resultado tal cual. */
  | {
      status: 'evaluated';
      clientUuid: string;
      level: HealthStatus;
      recommendation: string | null;
      escalation: EscalationLevel;
      /** Se creó un escalamiento (a la tripulación o a Tierra). */
      escalationId: string | null;
      emergency: AutoEmergency | null;
    }
  /**
   * Sin conexión: quedó en la cola; el servidor la evaluará al sincronizar y su resultado manda.
   * `device` = lo calculado en el dispositivo con las reglas guardadas (GET /rules) y el mismo motor del
   * servidor, "pendiente de confirmar"; null = "sin evaluar" (sin reglas guardadas o la regla usa derivados).
   */
  | {
      status: 'queued';
      clientUuid: string;
      device: { level: HealthStatus; recommendation: string | null; escalation: EscalationLevel } | null;
    }
  /** Modo demo sin servidor o indicador sin código en el catálogo: solo en el dispositivo. */
  | { status: 'local'; clientUuid: string };
