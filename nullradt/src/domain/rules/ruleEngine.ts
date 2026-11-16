import type { SourceRef } from '../entities/Hazard';
import type { EscalationLevel, HealthStatus, IndicatorId } from '../entities/HealthIndicator';
import { CALCIURIA_LIMIT, EWGSOP2, GRIP_LOW, STATPEARLS_CALCIURIA, type Sex } from './sexReference';

/**
 * MOTOR DE EVALUACIÓN POR REGLAS (función pura, sin React: la misma corre en el dispositivo y en el servidor).
 *
 * Regla del proyecto: ningún umbral clínico se inventa. Cada indicador usa una de estas reglas:
 * - news2:     puntuación NEWS2 (Royal College of Physicians, 2017) → 0 normal · 1–2 precaución · ≥3 crítico.
 * - aha:       categorías de presión arterial de la AHA + sistólica ≤ 90 de NEWS2.
 * - reference: rango de referencia publicado (presión intraocular 10–21 mmHg, American Academy of Ophthalmology).
 * - baseline:  desviación contra TU línea base personal (no es un umbral clínico; el % es configurable por el flight surgeon).
 * - sex:       corte clínico distinto por sexo (calcio urinario: StatPearls; fuerza de agarre baja: EWGSOP2).
 * - none:      sin regla validada a bordo → "no evaluado" y se envía a revisión experta.
 *
 * Escalamiento: autocuidado → tripulación → flight surgeon.
 *  normal → autocuidado · precaución aislada → autocuidado (repetir medición) ·
 *  precaución persistente (2 de las últimas 3) → tripulación · crítico → flight surgeon (y aviso inmediato a la tripulación).
 */

export const NEWS2: SourceRef = {
  title: 'National Early Warning Score (NEWS) 2 — Royal College of Physicians, 2017',
  url: 'https://www.rcp.ac.uk/improving-care/resources/national-early-warning-score-news-2/',
};
export const AHA_BP: SourceRef = {
  title: 'Understanding Blood Pressure Readings — American Heart Association',
  url: 'https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings',
};
export const AAO_IOP: SourceRef = {
  title: 'Eye Pressure (normal 10–21 mmHg) — American Academy of Ophthalmology',
  url: 'https://www.aao.org/eye-health/anatomy/eye-pressure',
};
export const PERSONAL_BASELINE: SourceRef = {
  title: 'Personal baseline deviation (configurable; not a clinical threshold)',
  url: 'https://www.nasa.gov/hrp/',
};

export type RuleKind = 'news2' | 'aha' | 'reference' | 'baseline' | 'sex' | 'none';

export interface IndicatorRule {
  kind: RuleKind;
  source?: SourceRef;
  /** baseline: cuánto peor que la media personal pasa a precaución (fracción). */
  baselineTolerance?: number;
  /** baseline: true si un valor más alto es peor (tiempo de reacción). */
  higherIsWorse?: boolean;
  /** Bandas para dibujar en la gráfica (en las unidades del indicador). */
  bands?: { normal: [number, number]; caution?: [number, number][] };
}

export const RULES: Record<IndicatorId, IndicatorRule> = {
  heartRate: { kind: 'news2', source: NEWS2, bands: { normal: [51, 90], caution: [[41, 50], [91, 130]] } },
  spo2: { kind: 'news2', source: NEWS2, bands: { normal: [96, 100], caution: [[92, 95]] } },
  respRate: { kind: 'news2', source: NEWS2, bands: { normal: [12, 20], caution: [[9, 11], [21, 24]] } },
  bodyTemperature: { kind: 'news2', source: NEWS2, bands: { normal: [36.1, 38], caution: [[35.1, 36], [38.1, 39]] } },
  bloodPressure: { kind: 'aha', source: AHA_BP, bands: { normal: [111, 119], caution: [[91, 110], [120, 180]] } },
  eyePressure: { kind: 'reference', source: AAO_IOP, bands: { normal: [10, 21] } },
  reactionTime: { kind: 'baseline', source: PERSONAL_BASELINE, baselineTolerance: 0.15, higherIsWorse: true },
  // Línea base personal + corte de fuerza baja por sexo (EWGSOP2).
  gripStrength: { kind: 'baseline', source: PERSONAL_BASELINE, baselineTolerance: 0.1, higherIsWorse: false },
  urinaryCalcium: { kind: 'sex', source: STATPEARLS_CALCIURIA },
  // Indicadores del catálogo del servidor sin regla en la demo: los evalúa SOLO el servidor (no se inventan umbrales).
  glucose: { kind: 'none' },
  sleepHours: { kind: 'none' },
  radDoseDaily: { kind: 'none' },
  radDoseCum: { kind: 'none' },
  bodyMass: { kind: 'none' },
  exerciseMin: { kind: 'none' },
  visionCheck: { kind: 'none' },
  symptoms: { kind: 'none' },
};

export interface RuleResult {
  status: HealthStatus;
  escalation: EscalationLevel;
  kind: RuleKind;
  source?: SourceRef;
  /** Clave i18n del motivo: rules.reasons.<reason>. */
  reason: string;
  /** Precaución repetida → se escala a la tripulación. */
  persistent: boolean;
  /** Minutos para repetir la medición (si aplica). */
  remeasureMin?: number;
}

const fromScore = (score: number): Exclude<HealthStatus, 'unevaluated'> => (score >= 3 ? 'critical' : score >= 1 ? 'caution' : 'normal');

/** Puntuación NEWS2 de un parámetro (tabla oficial). */
export function news2Score(id: 'heartRate' | 'spo2' | 'respRate' | 'bodyTemperature', v: number): number {
  switch (id) {
    case 'heartRate':
      return v <= 40 || v >= 131 ? 3 : v >= 111 ? 2 : v <= 50 || v >= 91 ? 1 : 0;
    case 'spo2':
      return v <= 91 ? 3 : v <= 93 ? 2 : v <= 95 ? 1 : 0;
    case 'respRate':
      return v <= 8 || v >= 25 ? 3 : v >= 21 ? 2 : v <= 11 ? 1 : 0;
    case 'bodyTemperature':
      return v <= 35 ? 3 : v >= 39.1 ? 2 : v <= 36 || v >= 38.1 ? 1 : 0;
  }
}

function bloodPressureStatus(sys: number, dia = 0): { status: Exclude<HealthStatus, 'unevaluated'>; reason: string } {
  if (sys > 180 || dia > 120) return { status: 'critical', reason: 'bpCrisis' };
  if (sys <= 90) return { status: 'critical', reason: 'bpLow' };
  if (sys >= 130 || dia >= 80) return { status: 'caution', reason: 'bpHigh' };
  if (sys >= 120) return { status: 'caution', reason: 'bpElevated' };
  if (sys <= 110) return { status: 'caution', reason: 'bpLowish' };
  return { status: 'normal', reason: 'inRange' };
}

/** Clasificación sin historial (para lecturas sueltas y la simulación). */
export function classify(id: IndicatorId, value: number, secondary?: number, history: number[] = [], sex?: Sex): { status: HealthStatus; reason: string } {
  const rule = RULES[id];
  // Fuerza de agarre por debajo del corte de EWGSOP2 para tu sexo: precaución aunque no haya línea base.
  if (id === 'gripStrength' && sex && value < GRIP_LOW[sex]) return { status: 'caution', reason: 'gripLow' };
  switch (rule.kind) {
    case 'news2': {
      const s = fromScore(news2Score(id as 'heartRate', value));
      return { status: s, reason: s === 'normal' ? 'inRange' : s === 'caution' ? 'news2Low' : 'news2High' };
    }
    case 'aha':
      return bloodPressureStatus(value, secondary);
    case 'reference':
      return value > 21 ? { status: 'caution', reason: 'iopHigh' } : value < 10 ? { status: 'caution', reason: 'iopLow' } : { status: 'normal', reason: 'inRange' };
    case 'baseline': {
      if (history.length < 3) return { status: 'unevaluated', reason: 'noBaseline' };
      const mean = history.reduce((a, b) => a + b, 0) / history.length;
      const tol = rule.baselineTolerance ?? 0.15;
      const worse = rule.higherIsWorse ? value > mean * (1 + tol) : value < mean * (1 - tol);
      return worse ? { status: 'caution', reason: 'baselineWorse' } : { status: 'normal', reason: 'baselineOk' };
    }
    case 'sex':
      if (!sex) return { status: 'unevaluated', reason: 'noSex' };
      return value > CALCIURIA_LIMIT[sex] ? { status: 'caution', reason: 'calciumHigh' } : { status: 'normal', reason: 'inRange' };
    case 'none':
      return { status: 'unevaluated', reason: 'noRule' };
  }
}

/**
 * Evaluación completa con escalamiento.
 * @param recentStatuses estados de las lecturas anteriores (más reciente al final) para detectar persistencia.
 * @param history valores anteriores (para reglas de línea base).
 */
export function evaluateIndicator(
  id: IndicatorId,
  value: number,
  secondary?: number,
  ctx: { history?: number[]; recentStatuses?: HealthStatus[]; sex?: Sex } = {},
): RuleResult {
  const rule = RULES[id];
  const { status, reason } = classify(id, value, secondary, ctx.history, ctx.sex);
  const prev = (ctx.recentStatuses ?? []).slice(-2);
  const persistent = status === 'caution' && prev.some((s) => s === 'caution' || s === 'critical');
  const escalation: EscalationLevel = status === 'critical' ? 'flightSurgeon' : persistent ? 'crew' : 'self';
  return {
    status,
    escalation,
    kind: rule.kind,
    source: id === 'gripStrength' && reason === 'gripLow' ? EWGSOP2 : rule.source,
    reason,
    persistent,
    remeasureMin: status === 'caution' && !persistent ? 15 : status === 'critical' ? 5 : undefined,
  };
}
