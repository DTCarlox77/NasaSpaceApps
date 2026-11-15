import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemePreference = 'system' | 'light' | 'dark';
export type LanguagePreference = 'system' | 'es' | 'en';
/** Modelo del cuerpo 3D: sigue el sexo del tripulante. */
export type BodyModel = 'female' | 'male';

interface SettingsState {
  themePreference: ThemePreference;
  languagePreference: LanguagePreference;
  /** Misión elegida en el login (paso 2). */
  selectedMissionId: string | null;
  hasHydrated: boolean;
  setThemePreference: (value: ThemePreference) => void;
  setLanguagePreference: (value: LanguagePreference) => void;
  setSelectedMissionId: (id: string | null) => void;
}

/** Preferencias de UI persistidas en el dispositivo (funciona offline). */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themePreference: 'system',
      languagePreference: 'system',
      selectedMissionId: null,
      hasHydrated: false,
      setThemePreference: (themePreference) => set({ themePreference }),
      setLanguagePreference: (languagePreference) => set({ languagePreference }),
      setSelectedMissionId: (selectedMissionId) => set({ selectedMissionId }),
    }),
    {
      name: 'nullradt-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ themePreference, languagePreference, selectedMissionId }) => ({
        themePreference,
        languagePreference,
        selectedMissionId,
      }),
      onRehydrateStorage: () => () => useSettingsStore.setState({ hasHydrated: true }),
    },
  ),
);
