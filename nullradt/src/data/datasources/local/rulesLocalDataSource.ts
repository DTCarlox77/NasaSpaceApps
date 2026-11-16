import AsyncStorage from '@react-native-async-storage/async-storage';
import type { IndicatorRule } from '@/core/engine/conditions';

/**
 * Reglas del semáforo (GET /rules) para evaluar sin conexión con el mismo `conditions.js` del servidor.
 * Se guardan por indicador con su `rules_version`; el pull avisa con `rules.changed` y se piden solo las
 * nuevas (`since_version`). No son datos personales: sobreviven al cierre de sesión.
 */
const KEY = 'nullradt-rules-v1';

export interface StoredRules {
  rulesVersion: number;
  catalogVersion: number;
  indicators: Record<string, { rules_version: number; rules: IndicatorRule[] }>;
  fetchedAt: string;
}

export const rulesLocalDataSource = {
  async get(): Promise<StoredRules | null> {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as StoredRules) : null;
    } catch {
      return null;
    }
  },
  async set(rules: StoredRules) {
    await AsyncStorage.setItem(KEY, JSON.stringify(rules));
  },
};
