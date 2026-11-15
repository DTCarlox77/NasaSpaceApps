import type { ReadingInput, ReadingOutcome } from '../entities/ReadingSubmission';
import type { HealthRepository } from '../repositories/HealthRepository';

/** Registra una lectura: el servidor la evalúa (semáforo y recomendación); la app no inventa umbrales. */
export class SubmitReading {
  constructor(private readonly repository: HealthRepository) {}

  execute(input: ReadingInput): Promise<ReadingOutcome> {
    return this.repository.submitReading(input);
  }
}
