import { create } from 'zustand';
import { container } from '@/di/container';

/** Foto de perfil compartida (encabezado, perfil, login). */
interface ProfileState {
  photoUri: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  setPhoto: (sourceUri: string) => Promise<void>;
  removePhoto: () => Promise<void>;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  photoUri: null,
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    set({ photoUri: await container.getProfilePhoto.execute(), loaded: true });
  },
  setPhoto: async (sourceUri) => {
    set({ photoUri: await container.setProfilePhoto.execute(sourceUri) });
  },
  removePhoto: async () => {
    await container.removeProfilePhoto.execute();
    set({ photoUri: null });
  },
}));
