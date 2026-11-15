import type { DeliveryResult, EmergencyReport } from '@/domain/entities/EmergencyReport';
import type { EmergencyReportRepository } from '@/domain/repositories/EmergencyReportRepository';
import { pendingReportsLocalDataSource } from '../datasources/local/pendingReportsLocalDataSource';
import { alertsRemoteDataSource } from '../datasources/remote/alertsRemoteDataSource';

export class EmergencyReportRepositoryImpl implements EmergencyReportRepository {
  constructor(
    private readonly remote = alertsRemoteDataSource,
    private readonly local = pendingReportsLocalDataSource,
  ) {}

  async submit(report: EmergencyReport): Promise<DeliveryResult> {
    try {
      await this.remote.send(report);
      return { status: 'sent', report };
    } catch (e) {
      await this.local.add(report);
      return { status: 'queued', report, reason: e instanceof Error ? e.message : 'unknown' };
    }
  }

  async flushPending(): Promise<number> {
    const pending = await this.local.getAll();
    const remaining: EmergencyReport[] = [];
    let sent = 0;
    for (const report of pending) {
      try {
        await this.remote.send(report);
        sent++;
      } catch {
        remaining.push(report);
      }
    }
    await this.local.saveAll(remaining);
    return sent;
  }

  async pendingCount(): Promise<number> {
    return (await this.local.getAll()).length;
  }
}
