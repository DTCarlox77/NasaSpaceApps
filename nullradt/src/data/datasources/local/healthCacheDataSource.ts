import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HealthIndicator } from '@/domain/entities/HealthIndicator';

const KEY = 'nullradt-health-cache';

/** Última respuesta del backend, para seguir funcionando sin enlace con la Tierra. */
export const healthCacheDataSource = {
  async get(): Promise<{ indicators: HealthIndicator[]; fetchedAt: string } | null> {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  async set(indicators: HealthIndicator[], fetchedAt: string) {
    await AsyncStorage.setItem(KEY, JSON.stringify({ indicators, fetchedAt }));
  },
};
