export type MissionEnvironment = 'spacecraft' | 'station' | 'rover' | 'lunarBase' | 'marsBase';

/** Fase de una misión: solo una misión activa permite abrir el expediente de salud. */
export type MissionPhase = 'active' | 'scheduled' | 'training';

/** Misión seleccionable en el login (paso 2). */
export interface Mission {
  id: string;
  name: string;
  vehicle: string;
  phase: MissionPhase;
  environment: MissionEnvironment;
  /** Gravedad relativa a la Tierra (0, 0.16 Luna, 0.38 Marte, 1). */
  gravity: number;
  day: number;
  totalDays: number;
  crew: number;
  location: string;
  synthetic: boolean;
}

export interface MissionStatus {
  missionDay: number;
  environment: MissionEnvironment;
  gravity: number;
  nextCheckInMinutes: number;
  checkInsDone: number;
  checkInsPlanned: number;
  streakDays: number;
  synthetic: boolean;
}
