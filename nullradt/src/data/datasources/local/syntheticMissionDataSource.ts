import type { Mission, MissionStatus } from '@/domain/entities/Mission';

/**
 * DATOS SINTÉTICOS de demostración (misiones de ejemplo del diseño en Figma).
 * No provienen de ninguna misión ni astronauta real.
 */
const MISSIONS: Mission[] = [
  {
    id: 'artemis-gateway-7',
    name: 'Artemis Gateway · Expedition 7',
    vehicle: 'Lunar Gateway — HALO module',
    phase: 'active',
    environment: 'station',
    gravity: 0,
    day: 142,
    totalDays: 210,
    crew: 4,
    location: 'Near-rectilinear halo orbit',
    synthetic: true,
  },
  {
    id: 'lunar-sortie-ls3',
    name: 'Lunar Surface Sortie LS-3',
    vehicle: 'Human Landing System',
    phase: 'scheduled',
    environment: 'lunarBase',
    gravity: 0.16,
    day: 0,
    totalDays: 30,
    crew: 2,
    location: 'Lunar south pole',
    synthetic: true,
  },
  {
    id: 'hera-24',
    name: 'HERA Analog Campaign 24',
    vehicle: 'Ground analog habitat',
    phase: 'training',
    environment: 'spacecraft',
    gravity: 1,
    day: 0,
    totalDays: 45,
    crew: 4,
    location: 'Johnson Space Center',
    synthetic: true,
  },
];

export const syntheticMissionDataSource = {
  getMissions: async (): Promise<Mission[]> => MISSIONS,
  getStatus: async (): Promise<MissionStatus> => ({
    missionDay: MISSIONS[0].day,
    environment: MISSIONS[0].environment,
    gravity: MISSIONS[0].gravity,
    nextCheckInMinutes: 120,
    checkInsDone: 3,
    checkInsPlanned: 5,
    streakDays: 23,
    synthetic: true,
  }),
};
