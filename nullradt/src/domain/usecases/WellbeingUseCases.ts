import type { CheckInInput, PvtRunInput, ScreeningInput, SupportRequestInput } from '../entities/Wellbeing';
import { PVT_LAPSE_MS } from '../entities/Wellbeing';
import type { WellbeingRepository } from '../repositories/WellbeingRepository';

const clamp01 = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export class SubmitCheckIn {
  constructor(private readonly repository: WellbeingRepository) {}

  execute(input: CheckInInput) {
    return this.repository.submitCheckIn({
      ...input,
      mood: clamp01(input.mood),
      fatigue: clamp01(input.fatigue),
      stress: clamp01(input.stress),
      crewConflict: clamp01(input.crewConflict),
      privateNote: input.privateNote?.trim() ? input.privateNote.trim().slice(0, 1000) : null,
    });
  }
}

export class RequestSupport {
  constructor(private readonly repository: WellbeingRepository) {}

  execute(input: SupportRequestInput) {
    return this.repository.requestSupport({ ...input, content: input.content.trim().slice(0, 2000) });
  }
}

/** Métricas del PVT a partir de cada tiempo de reacción medido (ms). */
export function pvtMetrics(reactionTimesMs: number[]) {
  const trials = reactionTimesMs.length;
  const lapses = reactionTimesMs.filter((ms) => ms >= PVT_LAPSE_MS).length;
  const meanRtMs = trials ? Math.round(reactionTimesMs.reduce((a, b) => a + b, 0) / trials) : 0;
  return { trials, lapses, meanRtMs };
}

export class SubmitPvtRun {
  constructor(private readonly repository: WellbeingRepository) {}

  execute(input: PvtRunInput) {
    return this.repository.submitPvtRun(input);
  }
}

export class GetInstruments {
  constructor(private readonly repository: WellbeingRepository) {}

  execute(lang: 'es' | 'en') {
    return this.repository.getInstruments(lang);
  }
}

export class SubmitScreening {
  constructor(private readonly repository: WellbeingRepository) {}

  execute(input: ScreeningInput) {
    return this.repository.submitScreening(input);
  }
}
