import type { HealthIndicator } from '../entities/HealthIndicator';
import type { ReadingInput, ReadingOutcome } from '../entities/ReadingSubmission';

export interface HealthSnapshot {
  indicators: HealthIndicator[];
  /** De dónde salieron los datos: backend, caché offline o maqueta. */
  origin: 'remote' | 'cache' | 'mock';
  fetchedAt: string;
}

export interface HealthRepository {
  getSnapshot(): Promise<HealthSnapshot>;
  /**
   * Guarda una lectura: en línea (POST /readings, devuelve la evaluación del servidor) o, sin conexión,
   * en la cola de sync con su `client_uuid`. Sin API o sin código en el catálogo: solo local.
   */
  submitReading(input: ReadingInput): Promise<ReadingOutcome>;
}
