import AsyncStorage from '@react-native-async-storage/async-storage';

/** Cursor de GET /sync/pull por usuario (el mismo cursor devuelve lo mismo: se guarda solo tras procesar). */
const CURSOR_KEY = (ownerId: string) => `nullradt-sync-cursor:${ownerId}`;

export const syncStateLocalDataSource = {
  async getCursor(ownerId: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(CURSOR_KEY(ownerId));
    } catch {
      return null;
    }
  },
  async setCursor(ownerId: string, cursor: string) {
    await AsyncStorage.setItem(CURSOR_KEY(ownerId), cursor);
  },
};
