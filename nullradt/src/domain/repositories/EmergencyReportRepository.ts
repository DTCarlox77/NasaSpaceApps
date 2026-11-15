import type { ConfirmOkOutcome, DeliveryResult, EmergencyReport, EmergencySessionInfo } from '../entities/EmergencyReport';

export interface EmergencyReportRepository {
  /**
   * Crítico → POST /emergency/sessions (o cola con prioridad emergencia si no hay red).
   * Precaución o modo demo → solo en el dispositivo. Nunca pierde el informe.
   */
  submit(report: EmergencyReport): Promise<DeliveryResult>;
  /** GET /emergency/sessions/{id}. null si no se pudo leer. */
  getSession(id: string): Promise<EmergencySessionInfo | null>;
  /** "Estoy bien" (POST /emergency/sessions/{id}/confirm). */
  confirmOk(sessionId: string): Promise<ConfirmOkOutcome>;
  /** Cierra la sesión (solo comandante u oficial médico): `cancelled` = falsa alarma. */
  close(sessionId: string, status: 'closed' | 'cancelled', notes?: string): Promise<'closed' | 'queued' | 'forbidden'>;
}
