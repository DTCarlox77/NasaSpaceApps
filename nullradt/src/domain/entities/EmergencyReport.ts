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
  /** Toda la demo usa datos sintéticos. */
  synthetic: boolean;
}

export type DeliveryResult =
  /** La API confirmó recepción. */
  | { status: 'sent'; report: EmergencyReport }
  /** Sin conexión o API caída: queda en cola local y se reintenta luego. */
  | { status: 'queued'; report: EmergencyReport; reason: string };
