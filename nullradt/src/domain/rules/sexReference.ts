import type { SourceRef } from '../entities/Hazard';
import type { IndicatorId } from '../entities/HealthIndicator';

/**
 * RANGOS DE REFERENCIA POR SEXO (y edad cuando la fuente lo da). Ninguna cifra es inventada: cada una está
 * copiada de la fuente citada. Se usan para mostrar "tu rango normal" y, donde la fuente define un corte
 * clínico por sexo (calcio urinario, fuerza de agarre), también en el motor de reglas.
 */
export type Sex = 'female' | 'male';

export const NHANES_PULSE: SourceRef = {
  title:
    'Ostchega Y, Porter KS, Hughes J, Dillon CF, Nwankwo T. Resting pulse rate reference data for children, adolescents, and adults: United States, 1999–2008. National Health Statistics Reports no. 41. CDC/NCHS, 2011 (Tables 2 and 3).',
  url: 'https://www.cdc.gov/nchs/data/nhsr/nhsr041.pdf',
};
export const EWGSOP2: SourceRef = {
  title:
    'Cruz-Jentoft AJ, et al. Sarcopenia: revised European consensus on definition and diagnosis (EWGSOP2). Age and Ageing 2019;48:16–31 — cut-offs from Dodds RM, et al. PLoS ONE 2014;9:e113637.',
  url: 'https://doi.org/10.1093/ageing/afy169',
};
export const DODDS_GRIP: SourceRef = {
  title: 'Dodds RM, et al. Grip strength across the life course: normative data from twelve British studies. PLoS ONE 2014;9(12):e113637.',
  url: 'https://doi.org/10.1371/journal.pone.0113637',
};
export const STATPEARLS_CALCIURIA: SourceRef = {
  title: 'Hypercalciuria. StatPearls — StatPearls Publishing, NCBI Bookshelf NBK448183 (> 275 mg/day in men, > 250 mg/day in women).',
  url: 'https://www.ncbi.nlm.nih.gov/books/NBK448183/',
};

/** Percentiles de pulso en reposo (lpm), NHANES 1999–2008, Tablas 2 (hombres) y 3 (mujeres). */
interface PulseRow {
  ages: [number, number];
  mean: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}
const PULSE: Record<Sex, PulseRow[]> = {
  male: [
    { ages: [16, 19], mean: 72, p5: 52, p25: 61, p50: 69, p75: 78, p95: 92 },
    { ages: [20, 39], mean: 71, p5: 52, p25: 61, p50: 69, p75: 76, p95: 89 },
    { ages: [40, 59], mean: 71, p5: 52, p25: 61, p50: 68, p75: 77, p95: 90 },
    { ages: [60, 79], mean: 70, p5: 50, p25: 60, p50: 67, p75: 75, p95: 91 },
  ],
  female: [
    { ages: [16, 19], mean: 79, p5: 58, p25: 69, p50: 77, p75: 85, p95: 99 },
    { ages: [20, 39], mean: 76, p5: 57, p25: 66, p50: 74, p75: 82, p95: 95 },
    { ages: [40, 59], mean: 73, p5: 56, p25: 64, p50: 71, p75: 79, p95: 92 },
    { ages: [60, 79], mean: 73, p5: 56, p25: 64, p50: 70, p75: 78, p95: 92 },
  ],
};

/** Hipercalciuria (mg/24 h) según StatPearls: > 275 en hombres, > 250 en mujeres. */
export const CALCIURIA_LIMIT: Record<Sex, number> = { male: 275, female: 250 };
/** Fuerza de agarre baja (kg) según EWGSOP2: < 27 en hombres, < 16 en mujeres. */
export const GRIP_LOW: Record<Sex, number> = { male: 27, female: 16 };
/** Mediana máxima de fuerza de agarre en la adultez joven (Dodds 2014): 51 kg hombres, 31 kg mujeres. */
const GRIP_PEAK_MEDIAN: Record<Sex, number> = { male: 51, female: 31 };

export interface SexReference {
  /** Tipo de referencia: percentiles poblacionales, corte clínico o igual para ambos sexos. */
  kind: 'percentile' | 'cutoff' | 'same';
  /** Rango "normal" a mostrar para este sexo (unidades del indicador). */
  min?: number;
  max?: number;
  /** Valor típico (mediana) si la fuente lo da. */
  typical?: number;
  /** Etiqueta de grupo de edad usada (p. ej. "20–39"). */
  ages?: string;
  source?: SourceRef;
}

const pulseRow = (sex: Sex, age: number) => PULSE[sex].find((r) => age >= r.ages[0] && age <= r.ages[1]) ?? PULSE[sex][1]!;

/** Referencia para un indicador, sexo y edad. `same` = la fuente usa el mismo rango para hombres y mujeres. */
export function sexReference(id: IndicatorId, sex: Sex, age: number): SexReference {
  switch (id) {
    case 'heartRate': {
      const r = pulseRow(sex, age);
      return { kind: 'percentile', min: r.p5, max: r.p95, typical: r.p50, ages: `${r.ages[0]}–${r.ages[1]}`, source: NHANES_PULSE };
    }
    case 'urinaryCalcium':
      return { kind: 'cutoff', max: CALCIURIA_LIMIT[sex], source: STATPEARLS_CALCIURIA };
    case 'gripStrength':
      return { kind: 'cutoff', min: GRIP_LOW[sex], typical: GRIP_PEAK_MEDIAN[sex], source: EWGSOP2 };
    default:
      return { kind: 'same' };
  }
}

/** Indicadores cuya evaluación (no solo la referencia mostrada) depende del sexo. */
export const SEX_DEPENDENT_RULES: IndicatorId[] = ['urinaryCalcium', 'gripStrength'];
