import type { DeliveryResult, EmergencyReport, ReportSeverity, ReportTrigger } from '../entities/EmergencyReport';
import type { EmergencyReportRepository } from '../repositories/EmergencyReportRepository';

export interface SendEmergencyReportInput {
  severity: ReportSeverity;
  trigger: ReportTrigger;
  language: 'es' | 'en';
  missionDay?: number;
  note?: string;
}

const makeId = () => `rpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export class SendEmergencyReport {
  constructor(private readonly repository: EmergencyReportRepository) {}

  execute(input: SendEmergencyReportInput): Promise<DeliveryResult> {
    const report: EmergencyReport = {
      id: makeId(),
      createdAt: new Date().toISOString(),
      synthetic: true,
      ...input,
    };
    return this.repository.submit(report);
  }
}

export class FlushPendingReports {
  constructor(private readonly repository: EmergencyReportRepository) {}

  execute(): Promise<number> {
    return this.repository.flushPending();
  }
}
