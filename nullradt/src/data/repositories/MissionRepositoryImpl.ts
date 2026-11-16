import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiEnabled } from '@/core/config/env';
import type { Mission, MissionEnvironment, MissionStatus } from '@/domain/entities/Mission';
import type { MissionRepository } from '@/domain/repositories/MissionRepository';
import { syntheticMissionDataSource } from '../datasources/local/syntheticMissionDataSource';
import { wellbeingLocalDataSource } from '../datasources/local/wellbeingLocalDataSource';
import { crewRemoteDataSource } from '../datasources/remote/crewRemoteDataSource';
import { serverSession } from './outbox';

const ENV_FROM_API: Record<string, MissionEnvironment> = {
  spacecraft: 'spacecraft',
  space_station: 'station',
  rover: 'rover',
  lunar_base: 'lunarBase',
  mars_base: 'marsBase',
};

const DAY = 86_400_000;
const MISSION_KEY = 'nullradt-mission-cache';

/**
 * - Sin API: misiones sintéticas del Figma (se elige en el login).
 * - Con API: la misión la asigna el servidor (GET /missions/current); el astronauta no la elige.
 */
export class MissionRepositoryImpl implements MissionRepository {
  constructor(
    private readonly local = syntheticMissionDataSource,
    private readonly remote = crewRemoteDataSource,
  ) {}

  private async serverMission(): Promise<Mission | null> {
    const session = await serverSession();
    if (!session) return null;
    try {
      const cur = await this.remote.currentMission();
      const crew = await this.remote.crew(cur.mission.id).catch(() => []);
      const start = cur.mission.starts_at ? new Date(cur.mission.starts_at).getTime() : null;
      const end = cur.mission.ends_at ? new Date(cur.mission.ends_at).getTime() : null;
      const mission: Mission = {
        id: cur.mission.id,
        name: cur.mission.name,
        vehicle: cur.environment.name,
        phase: cur.mission.status === 'active' ? 'active' : cur.mission.status === 'planned' ? 'scheduled' : 'training',
        environment: ENV_FROM_API[cur.environment.type] ?? 'spacecraft',
        gravity: cur.environment.gravity_g,
        day: start ? Math.max(1, Math.floor((Date.now() - start) / DAY) + 1) : 0,
        // ends_at null = sin fin conocido: 0 (la interfaz muestra solo el día).
        totalDays: start && end ? Math.max(1, Math.round((end - start) / DAY)) : 0,
        crew: crew.length,
        location: `${cur.environment.name} · ${cur.mission.code}`,
        synthetic: true,
      };
      await AsyncStorage.setItem(MISSION_KEY, JSON.stringify(mission)).catch(() => {});
      return mission;
    } catch {
      try {
        const raw = await AsyncStorage.getItem(MISSION_KEY);
        if (raw) return JSON.parse(raw) as Mission;
      } catch {
        // sigue abajo
      }
      // Sin red y sin caché: lo que trajo el login.
      return session.mission
        ? {
            id: session.mission.id,
            name: session.mission.name,
            vehicle: session.environment?.name ?? session.mission.code,
            phase: session.mission.status === 'active' ? 'active' : 'scheduled',
            environment: ENV_FROM_API[session.environment?.type ?? ''] ?? 'spacecraft',
            gravity: session.environment?.gravityG ?? 0,
            day: 0,
            totalDays: 0,
            crew: 0,
            location: session.mission.code,
            synthetic: true,
          }
        : null;
    }
  }

  async getStatus(): Promise<MissionStatus> {
    if (!apiEnabled()) return this.local.getStatus();
    const [mission, session] = await Promise.all([this.serverMission(), serverSession()]);
    const streak = (session && (await wellbeingLocalDataSource.getStreak(session.userId))) || {
      streakDays: 0,
      checkinsThisWeek: 0,
      checkinsGoalWeek: 7,
    };
    return {
      missionDay: mission?.day ?? 0,
      environment: mission?.environment ?? 'spacecraft',
      gravity: mission?.gravity ?? 0,
      nextCheckInMinutes: 0,
      // Progreso del check-in = racha del servidor (cuenta check-ins hechos, nunca el resultado).
      checkInsDone: streak.checkinsThisWeek,
      checkInsPlanned: streak.checkinsGoalWeek || 7,
      streakDays: streak.streakDays,
      synthetic: true,
    };
  }

  async getMissions(): Promise<Mission[]> {
    if (!apiEnabled()) return this.local.getMissions();
    const m = await this.serverMission();
    return m ? [m] : [];
  }
}
