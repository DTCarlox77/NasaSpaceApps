import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Streak } from '@/domain/entities/Wellbeing';

const STREAK_KEY = (ownerId: string) => `nullradt-wb-streak:${ownerId}`;

/** Última racha de check-in que devolvió el servidor (cuenta check-ins hechos, nunca el resultado). */
export const wellbeingLocalDataSource = {
  async getStreak(ownerId: string): Promise<Streak | null> {
    try {
      const raw = await AsyncStorage.getItem(STREAK_KEY(ownerId));
      return raw ? (JSON.parse(raw) as Streak) : null;
    } catch {
      return null;
    }
  },
  async setStreak(ownerId: string, streak: Streak) {
    await AsyncStorage.setItem(STREAK_KEY(ownerId), JSON.stringify(streak)).catch(() => {});
  },
};
