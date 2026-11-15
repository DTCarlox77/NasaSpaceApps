import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import type { ProfileRepository } from '@/domain/repositories/ProfileRepository';

const KEY = 'nullradt-profile-photo';

/**
 * La imagen elegida vive en una caché temporal del sistema; la copiamos a la carpeta
 * de documentos de la app (permanente). Nombre único por foto para evitar imágenes en caché.
 */
export class ProfileRepositoryImpl implements ProfileRepository {
  async getPhotoUri(): Promise<string | null> {
    const uri = await AsyncStorage.getItem(KEY).catch(() => null);
    if (!uri) return null;
    try {
      return new File(uri).exists ? uri : null;
    } catch {
      return null;
    }
  }

  async savePhoto(sourceUri: string): Promise<string> {
    const ext = sourceUri.split('?')[0]!.split('.').pop()?.toLowerCase() ?? 'jpg';
    const dest = new File(Paths.document, `avatar-${Date.now()}.${ext.length <= 4 ? ext : 'jpg'}`);
    new File(sourceUri).copy(dest);
    await this.deleteCurrent();
    await AsyncStorage.setItem(KEY, dest.uri);
    return dest.uri;
  }

  async removePhoto(): Promise<void> {
    await this.deleteCurrent();
    await AsyncStorage.removeItem(KEY);
  }

  private async deleteCurrent() {
    const uri = await AsyncStorage.getItem(KEY).catch(() => null);
    if (!uri) return;
    try {
      const f = new File(uri);
      if (f.exists) f.delete();
    } catch {
      // Si ya no existe, no hay nada que borrar.
    }
  }
}
