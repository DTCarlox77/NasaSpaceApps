/**
 * Los 5 peligros del vuelo espacial (NASA HRP, acrónimo RIDGE).
 * Fuente: https://www.nasa.gov/hrp/hazards/
 * El texto visible vive en i18n (`hazards.<id>`); aquí solo hay datos de dominio.
 */
export type HazardId = 'radiation' | 'isolation' | 'distance' | 'gravity' | 'environment';

export interface SourceRef {
  title: string;
  url: string;
}

export interface Hazard {
  id: HazardId;
  /** Letra del acrónimo RIDGE. */
  letter: 'R' | 'I' | 'D' | 'G' | 'E';
  source: SourceRef;
}
