import type {
  CheckInInput,
  CheckInOutcome,
  Instrument,
  PvtOutcome,
  PvtRunInput,
  ScreeningInput,
  ScreeningOutcome,
  SupportOutcome,
  SupportRequestInput,
} from '@/domain/entities/Wellbeing';
import type { WellbeingRepository } from '@/domain/repositories/WellbeingRepository';
import { newUuid } from '@/domain/usecases/uuid';
import { sessionSecureDataSource } from '../datasources/local/sessionSecureDataSource';
import { wellbeingLocalDataSource } from '../datasources/local/wellbeingLocalDataSource';
import type { ApiWellbeingAck } from '../datasources/remote/apiTypes';
import { wellbeingRemoteDataSource } from '../datasources/remote/wellbeingRemoteDataSource';
import { sendOrQueue, serverSession } from './outbox';

export function streakFrom(ack: Pick<ApiWellbeingAck, 'streak'>) {
  return ack.streak
    ? { streakDays: ack.streak.streak_days, checkinsThisWeek: ack.streak.checkins_this_week, checkinsGoalWeek: ack.streak.checkins_goal_week }
    : null;
}

/**
 * Bienestar confidencial (guía §11). Sin API (demo) todo queda en el dispositivo.
 * Nunca se calcula ni se muestra un nivel: solo se devuelve el mensaje neutro del servidor.
 */
export class WellbeingRepositoryImpl implements WellbeingRepository {
  constructor(private readonly remote = wellbeingRemoteDataSource) {}

  async submitCheckIn(input: CheckInInput): Promise<CheckInOutcome> {
    const clientUuid = newUuid();
    const session = await serverSession();
    if (!session) return { status: 'local', clientUuid };
    const payload: Record<string, unknown> = {
      measured_at: input.measuredAt,
      mood: input.mood,
      fatigue: input.fatigue,
      stress: input.stress,
      crew_conflict: input.crewConflict,
      ...(input.sleepHours != null ? { sleep_hours: input.sleepHours } : {}),
      ...(input.privateNote ? { private_note: input.privateNote } : {}),
    };
    const res = await sendOrQueue({
      clientUuid,
      entity: 'wellbeing_checkin',
      ownerId: session.userId,
      payload,
      send: () => this.remote.createCheckIn({ client_uuid: clientUuid, ...payload }),
    });
    if (res.kind === 'queued') return { status: 'queued', clientUuid };
    const ack = res.value;
    const streak = streakFrom(ack);
    if (streak) await wellbeingLocalDataSource.setStreak(session.userId, streak);
    return {
      status: 'sent',
      clientUuid,
      message: ack.message,
      streak,
      screeningDue: !!ack.screening_due,
      supersedesId: ack.supersedes_id ?? null,
    };
  }

  async requestSupport(input: SupportRequestInput): Promise<SupportOutcome> {
    const clientUuid = newUuid();
    const session = await serverSession();
    if (!session) return { status: 'local', clientUuid };
    const payload = { urgency: input.urgency, channel: input.channel, content: input.content, created_at: input.createdAt };
    const res = await sendOrQueue({
      clientUuid,
      entity: 'support_request',
      ownerId: session.userId,
      payload,
      send: () => this.remote.createSupportRequest({ client_uuid: clientUuid, ...payload }),
    });
    if (res.kind === 'queued') return { status: 'queued', clientUuid };
    const r = res.value;
    return {
      status: 'sent',
      clientUuid,
      serverId: r.id,
      deliverAt: r.deliver_at ?? null,
      requestStatus: r.status,
      suggestions: r.suggestions ?? [],
    };
  }

  async submitPvtRun(input: PvtRunInput): Promise<PvtOutcome> {
    const clientUuid = newUuid();
    const session = await serverSession();
    if (!session) return { status: 'local', clientUuid };
    const payload: Record<string, unknown> = {
      device_id: input.deviceId ?? (await sessionSecureDataSource.getDeviceId()),
      measured_at: input.measuredAt,
      before_critical_task: input.beforeCriticalTask,
      ...(input.durationS ? { duration_s: Math.max(1, Math.round(input.durationS)) } : {}),
      trials: input.trials,
      lapses: input.lapses,
      mean_rt_ms: input.meanRtMs,
      false_starts: input.falseStarts,
    };
    const res = await sendOrQueue({
      clientUuid,
      entity: 'pvt_run',
      ownerId: session.userId,
      payload,
      send: () => this.remote.createPvtRun({ client_uuid: clientUuid, ...payload }),
    });
    if (res.kind === 'queued') return { status: 'queued', clientUuid };
    return { status: 'sent', clientUuid, fitness: res.value.fitness, message: res.value.message };
  }

  async getInstruments(lang: 'es' | 'en'): Promise<Instrument[]> {
    if (!(await serverSession())) return [];
    return this.remote.getInstruments(lang);
  }

  async submitScreening(input: ScreeningInput): Promise<ScreeningOutcome> {
    const clientUuid = newUuid();
    const session = await serverSession();
    if (!session) throw new Error('screening requires server');
    const payload = { instrument: input.instrument, measured_at: input.measuredAt, item_1: input.item1, item_2: input.item2 };
    const res = await sendOrQueue({
      clientUuid,
      entity: 'wellbeing_screening',
      ownerId: session.userId,
      payload,
      send: () => this.remote.createScreening({ client_uuid: clientUuid, ...payload }),
    });
    return res.kind === 'queued' ? { status: 'queued', clientUuid } : { status: 'sent', clientUuid, message: res.value.message };
  }
}
