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
} from '../entities/Wellbeing';

/** Bienestar confidencial (`/wellbeing/*`). Sin conexión, todo va a la cola de sync. */
export interface WellbeingRepository {
  submitCheckIn(input: CheckInInput): Promise<CheckInOutcome>;
  requestSupport(input: SupportRequestInput): Promise<SupportOutcome>;
  submitPvtRun(input: PvtRunInput): Promise<PvtOutcome>;
  getInstruments(lang: 'es' | 'en'): Promise<Instrument[]>;
  submitScreening(input: ScreeningInput): Promise<ScreeningOutcome>;
}
