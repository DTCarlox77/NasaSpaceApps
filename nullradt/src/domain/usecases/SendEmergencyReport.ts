import type { DeliveryResult, EmergencyReport, ReportSeverity, ReportTrigger } from '../entities/EmergencyReport';
import type { EmergencyReportRepository } from '../repositories/EmergencyReportRepository';
import { newUuid } from './uuid';

export interface SendEmergencyReportInput {
  severity: ReportSeverity;
  trigger: ReportTrigger;
  language: 'es' | 'en';
  missionDay?: number;
  note?: string;
  responderSafe?: boolean;
}

export class SendEmergencyReport {
  constructor(private readonly repository: EmergencyReportRepository) {}

  execute(input: SendEmergencyReportInput): Promise<DeliveryResult> {
    const report: EmergencyReport = {
      // El id es el client_uuid de la sesión de emergencia: se genera una vez y se reusa en cada reintento.
      id: newUuid(),
      createdAt: new Date().toISOString(),
      synthetic: true,
      ...input,
    };
    return this.repository.submit(report);
  }
}

export class GetEmergencySession {
  constructor(private readonly repository: EmergencyReportRepository) {}

  execute(id: string) {
    return this.repository.getSession(id);
  }
}

export class ConfirmOk {
  constructor(private readonly repository: EmergencyReportRepository) {}

  execute(sessionId: string) {
    return this.repository.confirmOk(sessionId);
  }
}

export class CloseEmergency {
  constructor(private readonly repository: EmergencyReportRepository) {}

  execute(sessionId: string, status: 'closed' | 'cancelled', notes?: string) {
    return this.repository.close(sessionId, status, notes);
  }
}
