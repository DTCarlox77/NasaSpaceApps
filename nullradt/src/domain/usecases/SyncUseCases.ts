import type { PullSummary, PushSummary } from '../entities/Sync';
import type { SyncRepository } from '../repositories/SyncRepository';

export interface SyncOutcome {
  push: PushSummary;
  pull: PullSummary | null;
}

/** Al reconectar: primero sube la cola (emergencias primero) y luego baja lo nuevo con el cursor guardado. */
export class SyncNow {
  constructor(private readonly repository: SyncRepository) {}

  async execute(ownerId: string): Promise<SyncOutcome> {
    const push = await this.repository.push(ownerId);
    const pull = push.offline ? null : await this.repository.pull(ownerId);
    return { push, pull };
  }
}

export class GetPendingSync {
  constructor(private readonly repository: SyncRepository) {}

  execute(ownerId: string) {
    return this.repository.pending(ownerId);
  }
}
