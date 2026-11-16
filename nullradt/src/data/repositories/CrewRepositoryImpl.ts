import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiEnabled } from '@/core/config/env';
import type { CrewStatusResult, RosterMember, RosterMission } from '@/domain/entities/Crew';
import type { CrewRepository } from '@/domain/repositories/CrewRepository';
import { crewMockDataSource } from '../datasources/mock/crewMockDataSource';
import { crewRemoteDataSource } from '../datasources/remote/crewRemoteDataSource';
import { HttpError } from '../datasources/remote/httpClient';
import { serverSession } from './outbox';

type Roster = { mission: RosterMission; members: RosterMember[] };
const ROSTER_KEY = 'nullradt-roster-cache';

/**
 * - Sin API (demo): tripulación sintética de relleno (maqueta).
 * - Con API: roster real (sin salud) y salud de compañeros SOLO por GET /api/v1/crew/status.
 *   Nunca datos de maqueta de salud de otros ni nada de bienestar de nadie.
 */
export class CrewRepositoryImpl implements CrewRepository {
  constructor(
    private readonly mock = crewMockDataSource,
    private readonly remote = crewRemoteDataSource,
  ) {}

  async list() {
    return apiEnabled() ? [] : this.mock.list();
  }

  private async cachedRoster(): Promise<Roster | null> {
    try {
      const raw = await AsyncStorage.getItem(ROSTER_KEY);
      return raw ? (JSON.parse(raw) as Roster) : null;
    } catch {
      return null;
    }
  }

  async getRoster(opts: { cachedOnly?: boolean } = {}): Promise<Roster | null> {
    if (!(await serverSession())) return null;
    if (opts.cachedOnly) return this.cachedRoster();
    try {
      const current = await this.remote.currentMission();
      const crew = await this.remote.crew(current.mission.id);
      const roster: Roster = {
        mission: {
          id: current.mission.id,
          code: current.mission.code,
          name: current.mission.name,
          startsAt: current.mission.starts_at ?? null,
          endsAt: current.mission.ends_at ?? null,
          environmentName: current.environment?.name,
          environmentType: current.environment?.type,
          gravityG: current.environment?.gravity_g,
          commDelaySeconds: current.comm?.delay_seconds ?? current.environment?.comm_delay_seconds,
          link: current.comm?.link,
        },
        members: crew.map((m) => ({ astronautId: m.astronaut_id, userId: m.user_id, callSign: m.call_sign, fullName: m.full_name, crewRole: m.crew_role })),
      };
      await AsyncStorage.setItem(ROSTER_KEY, JSON.stringify(roster)).catch(() => {});
      return roster;
    } catch {
      return this.cachedRoster();
    }
  }

  async getStatus(): Promise<CrewStatusResult> {
    if (!(await serverSession())) return { status: 'unavailable' };
    try {
      const res = await this.remote.crewStatus();
      return {
        status: 'ok',
        generatedAt: res.generated_at,
        viewerCrewRole: res.viewer_crew_role ?? null,
        crew: res.crew.map((c) => ({
          astronautId: c.astronaut_id,
          callSign: c.call_sign,
          displayName: c.display_name,
          crewRole: c.crew_role,
          emergency: c.emergency ? { sessionId: c.emergency.session_id, status: c.emergency.status } : null,
          crewAlerts: (c.crew_alerts ?? []).map((a) => ({
            escalationId: a.escalation_id,
            indicatorCode: a.indicator_code,
            indicatorName: a.indicator_name,
            level: a.level,
            createdAt: a.created_at,
          })),
          physical: c.physical
            ? {
                zones: c.physical.zones.map((z) => ({ zone: z.zone, worstLevel: z.worst_level })),
                indicators: c.physical.indicators.map((i) => ({ code: i.code, level: i.level, lastValue: i.last_value, measuredAt: i.measured_at })),
              }
            : null,
        })),
      };
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return { status: 'unavailable' };
      return { status: 'offline' };
    }
  }
}
