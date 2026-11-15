import type { DeliveryResult, EmergencyReport } from '../entities/EmergencyReport';

export interface EmergencyReportRepository {
  /** Intenta enviar; si falla, lo guarda en la cola local. Nunca pierde el informe. */
  submit(report: EmergencyReport): Promise<DeliveryResult>;
  /** Reintenta enviar los informes en cola. Devuelve cuántos se enviaron. */
  flushPending(): Promise<number>;
  pendingCount(): Promise<number>;
}
