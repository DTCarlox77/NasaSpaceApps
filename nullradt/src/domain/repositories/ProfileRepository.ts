/** Foto de perfil del astronauta (local; se sincronizará con el backend más adelante). */
export interface ProfileRepository {
  getPhotoUri(): Promise<string | null>;
  /** Copia la imagen a almacenamiento permanente y devuelve la nueva URI. */
  savePhoto(sourceUri: string): Promise<string>;
  removePhoto(): Promise<void>;
}
