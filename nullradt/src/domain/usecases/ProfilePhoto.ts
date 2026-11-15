import type { ProfileRepository } from '../repositories/ProfileRepository';

export class GetProfilePhoto {
  constructor(private readonly repository: ProfileRepository) {}
  execute() {
    return this.repository.getPhotoUri();
  }
}

export class SetProfilePhoto {
  constructor(private readonly repository: ProfileRepository) {}
  execute(sourceUri: string) {
    return this.repository.savePhoto(sourceUri);
  }
}

export class RemoveProfilePhoto {
  constructor(private readonly repository: ProfileRepository) {}
  execute() {
    return this.repository.removePhoto();
  }
}
