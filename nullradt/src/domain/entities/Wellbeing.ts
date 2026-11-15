/**
 * Bienestar (confidencial). Al astronauta nunca se le muestra un puntaje, un color ni un semáforo:
 * solo el mensaje neutro del servidor y la racha de check-ins completados.
 */

/** Deslizadores 0–100 (sin números visibles en la interfaz). */
export interface CheckInInput {
  mood: number;
  fatigue: number;
  stress: number;
  crewConflict: number;
  sleepHours?: number | null;
  privateNote?: string | null;
  measuredAt: string;
}

export interface Streak {
  streakDays: number;
  checkinsThisWeek: number;
  checkinsGoalWeek: number;
}

export type CheckInOutcome =
  | {
      status: 'sent';
      clientUuid: string;
      /** Mensaje neutro del servidor: se muestra tal cual. */
      message: string;
      streak: Streak | null;
      /** true = toca PHQ-2 / GAD-2. */
      screeningDue: boolean;
      /** No null = corrigió el check-in de hoy. */
      supersedesId: string | null;
    }
  | { status: 'queued' | 'local'; clientUuid: string };

export type SupportUrgency = 'later' | 'today' | 'now';
export type SupportChannel = 'message' | 'session';

export interface SupportRequestInput {
  urgency: SupportUrgency;
  channel: SupportChannel;
  content: string;
  createdAt: string;
}

export interface SupportSuggestion {
  code: 'guided_breathing' | 'talk_to_cmo';
  title: string;
  description: string;
}

export type SupportOutcome =
  | {
      status: 'sent';
      clientUuid: string;
      serverId: string;
      /** Llegada a Tierra; null = en cola esperando enlace. */
      deliverAt: string | null;
      requestStatus: 'open' | 'acknowledged' | 'closed';
      suggestions: SupportSuggestion[];
    }
  | { status: 'queued' | 'local'; clientUuid: string };

export interface PvtRunInput {
  deviceId?: string;
  measuredAt: string;
  beforeCriticalTask: boolean;
  durationS?: number;
  trials: number;
  /** Respuestas de 355 ms o más. */
  lapses: number;
  meanRtMs: number;
  falseStarts: number;
}

export type Fitness = 'fit' | 'not_confirmed';

export type PvtOutcome =
  | { status: 'sent'; clientUuid: string; fitness: Fitness; message: string }
  | { status: 'queued' | 'local'; clientUuid: string };

/** Umbral de lapso del PVT (contrato: `lapses` = respuestas de 355 ms o más). */
export const PVT_LAPSE_MS = 355;

export type InstrumentCode = 'PHQ2' | 'GAD2';

export interface Instrument {
  code: InstrumentCode;
  name: string;
  prompt: string;
  items: { code: string; text: string }[];
  options: { value: number; label: string }[];
  license: string;
  note?: string;
}

export interface ScreeningInput {
  instrument: InstrumentCode;
  measuredAt: string;
  item1: number;
  item2: number;
}

/** El puntaje nunca vuelve: solo un mensaje neutro. */
export type ScreeningOutcome = { status: 'sent'; clientUuid: string; message: string } | { status: 'queued'; clientUuid: string };
