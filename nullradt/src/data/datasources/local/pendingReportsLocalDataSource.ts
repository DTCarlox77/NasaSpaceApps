import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EmergencyReport } from '@/domain/entities/EmergencyReport';

const KEY = 'nullradt-pending-reports';

/** Cola local de informes no enviados (sobrevive a reinicios de la app). */
export const pendingReportsLocalDataSource = {
  async getAll(): Promise<EmergencyReport[]> {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as EmergencyReport[]) : [];
    } catch {
      return [];
    }
  },
  async saveAll(reports: EmergencyReport[]): Promise<void> {
    await AsyncStorage.setItem(KEY, JSON.stringify(reports));
  },
  async add(report: EmergencyReport): Promise<void> {
    const all = await this.getAll();
    if (!all.some((r) => r.id === report.id)) all.push(report);
    await this.saveAll(all);
  },
};
