import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HealthIndicator } from '@/domain/entities/HealthIndicator';
import type { ApiIndicatorList } from '../remote/apiTypes';

const KEY = 'nullradt-health-cache';
const CATALOG_KEY = 'nullradt-catalog-cache';

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
  /** Catálogo (GET /indicators): nombres, unidades, input_methods y fuentes. No es dato personal. */
  async getCatalog(): Promise<ApiIndicatorList | null> {
    try {
      const raw = await AsyncStorage.getItem(CATALOG_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  async setCatalog(catalog: ApiIndicatorList) {
    await AsyncStorage.setItem(CATALOG_KEY, JSON.stringify(catalog));
  },
  async clear() {
    await AsyncStorage.multiRemove([KEY]);
  },
};
