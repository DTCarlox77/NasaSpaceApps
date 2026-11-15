import { apiEnabled } from '@/core/config/env';
import type { OutboxItem, PullSummary, PushItemResult, PushSummary } from '@/domain/entities/Sync';
import type { SyncRepository } from '@/domain/repositories/SyncRepository';
import { outboxLocalDataSource } from '../datasources/local/outboxLocalDataSource';
import { sessionSecureDataSource } from '../datasources/local/sessionSecureDataSource';
import { syncStateLocalDataSource } from '../datasources/local/syncStateLocalDataSource';
import { wellbeingLocalDataSource } from '../datasources/local/wellbeingLocalDataSource';
import type { ApiSyncPullResponse, ApiWellbeingAck } from '../datasources/remote/apiTypes';
import { HttpError } from '../datasources/remote/httpClient';
import { SYNC_MAX_BATCH, syncRemoteDataSource } from '../datasources/remote/syncRemoteDataSource';
import { ANY_OWNER } from './outbox';
import { streakFrom } from './WellbeingRepositoryImpl';

const MAX_PULL_PAGES = 10;

/** Emergencias antes que todo (aunque el item diga `normal`), luego por antigüedad. */
const isEmergency = (i: OutboxItem) => i.priority === 'emergency' || i.entity.startsWith('emergency_');
const EMERGENCY_ORDER = ['emergency_session', 'emergency_confirm', 'emergency_close'];
function byPriority(a: OutboxItem, b: OutboxItem) {
  const ea = isEmergency(a) ? 0 : 1;
  const eb = isEmergency(b) ? 0 : 1;
  if (ea !== eb) return ea - eb;
  const oa = EMERGENCY_ORDER.indexOf(a.entity);
  const ob = EMERGENCY_ORDER.indexOf(b.entity);
  if (oa !== ob) return oa - ob;
  return a.createdAt.localeCompare(b.createdAt);
}

/**
 * Guía §3. Push: lotes de ≤ 500 y `results` en el mismo orden que `items`:
 *   accepted / duplicate → sacar · conflict → sacar y avisar · rejected → sacar, salvo ENTITY_NOT_SUPPORTED.
 * Errores del lote: sin red / 5xx / 429 → se conserva y se reintenta luego (es idempotente).
 * 400 / 403 / 413 → se conserva marcado, no se reintenta en este ciclo.
 */
export class SyncRepositoryImpl implements SyncRepository {
  constructor(
    private readonly remote = syncRemoteDataSource,
    private readonly outbox = outboxLocalDataSource,
    private readonly state = syncStateLocalDataSource,
  ) {}

  async pending(ownerId: string): Promise<OutboxItem[]> {
    const [mine, any] = await Promise.all([this.outbox.forOwner(ownerId), this.outbox.forOwner(ANY_OWNER)]);
    return [...mine, ...any].sort(byPriority);
  }

  async push(ownerId: string): Promise<PushSummary> {
    const queue = await this.pending(ownerId);
    if (!apiEnabled() || !queue.length) return { results: [], remaining: queue.length, offline: false };

    const deviceId = await sessionSecureDataSource.getDeviceId();
    const results: PushItemResult[] = [];
    let offline = false;

    for (let start = 0; start < queue.length; start += SYNC_MAX_BATCH) {
      const batch = queue.slice(start, start + SYNC_MAX_BATCH);
      try {
        const res = await this.remote.push({
          device_id: deviceId,
          sent_at: new Date().toISOString(),
          items: batch.map((i) => ({ client_uuid: i.clientUuid, entity: i.entity, priority: i.priority, created_at: i.createdAt, payload: i.payload })),
        });
        const remove: string[] = [];
        const keep: string[] = [];
        batch.forEach((item, idx) => {
          const r = res.results[idx];
          if (!r) return keep.push(item.clientUuid);
          const errorCode = r.error?.code;
          if (r.status === 'rejected' && errorCode === 'ENTITY_NOT_SUPPORTED') keep.push(item.clientUuid);
          else remove.push(item.clientUuid);
          results.push({ item, status: r.status, serverId: r.server_id ?? null, result: r.result ?? null, errorCode });
          if (item.entity === 'wellbeing_checkin' && r.status === 'accepted' && r.result) {
            const streak = streakFrom(r.result as Pick<ApiWellbeingAck, 'streak'>);
            if (streak) void wellbeingLocalDataSource.setStreak(ownerId, streak);
          }
        });
        await this.outbox.remove(remove);
        await this.outbox.markFailed(keep, 'ENTITY_NOT_SUPPORTED');
      } catch (e) {
        const err = e instanceof HttpError ? e : new HttpError('unknown');
        await this.outbox.markFailed(batch.map((i) => i.clientUuid), err.code ?? err.message);
        // Sin red / 5xx / 429: se reintenta el mismo lote más tarde. 400/403/413: no se reintenta igual ahora.
        offline = err.isRetryable;
        break;
      }
    }
    const remaining = (await this.pending(ownerId)).length;
    return { results, remaining, offline };
  }

  async pull(ownerId: string): Promise<PullSummary | null> {
    if (!apiEnabled()) return null;
    const summary: PullSummary = { evaluations: [], escalations: [], messages: [], link: null, serverTime: new Date().toISOString() };
    let cursor = await this.state.getCursor(ownerId);
    try {
      for (let page = 0; page < MAX_PULL_PAGES; page++) {
        const res: ApiSyncPullResponse = await this.remote.pull(cursor);
        summary.serverTime = res.server_time;
        summary.evaluations.push(
          ...res.evaluations.map((e) => ({
            clientUuid: e.client_uuid,
            indicatorCode: e.indicator_code,
            level: e.evaluation.level,
            recommendation: e.evaluation.recommendation ?? null,
            escalationId: e.escalation_id ?? null,
            measuredAt: e.measured_at,
          })),
        );
        summary.escalations.push(
          ...res.escalations.map((x) => ({
            id: x.id,
            level: x.level,
            priority: x.priority,
            status: x.status,
            reason: x.reason,
            createdAt: x.created_at,
            deliverAt: x.deliver_at,
          })),
        );
        summary.messages.push(
          ...res.messages.map((m) => ({
            id: m.id,
            channel: m.channel,
            threadId: m.thread_id,
            authorRole: m.author_role,
            body: m.body,
            createdAt: m.created_at,
            deliverAt: m.deliver_at,
          })),
        );
        if (res.mission) {
          summary.link = {
            status: res.mission.link.status,
            outageEndsAt: res.mission.link.outage_ends_at ?? null,
            commDelaySeconds: res.mission.comm_delay_seconds,
          };
        }
        cursor = res.cursor;
        await this.state.setCursor(ownerId, cursor);
        if (!res.has_more) break;
      }
      return summary;
    } catch {
      // El mismo cursor devuelve lo mismo: se reintenta en el próximo ciclo con el cursor anterior.
      return summary.evaluations.length || summary.messages.length || summary.escalations.length ? summary : null;
    }
  }
}
