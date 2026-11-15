/**
 * Check-in de bienestar (escalas visuales análogas sin números, como las VAS de NASA BHP Standard Measures).
 * Valores internos 0–100. Se evalúan CAMBIOS SOSTENIDOS contra el rango habitual de la persona, nunca un día suelto.
 * No es un diagnóstico.
 */
export type VasDimension = 'mood' | 'fatigue' | 'stress' | 'friction';
export const VAS_DIMENSIONS: VasDimension[] = ['mood', 'fatigue', 'stress', 'friction'];
/** En ánimo, más alto es mejor; en fatiga, estrés y roces, más alto es peor. */
export const HIGHER_IS_WORSE: Record<VasDimension, boolean> = { mood: false, fatigue: true, stress: true, friction: true };

export const TREND_RULES = { minBaseline: 5, sustainedDays: 3, sdFactor: 1.5, minSd: 8, windowDays: 28 } as const;

export interface VasEntry {
  day: string;
  vas: Partial<Record<VasDimension, number>>;
}

export interface SustainedChange {
  dimension: VasDimension;
  baselineMean: number;
  recentMean: number;
}

/**
 * Cambio sostenido: los últimos `sustainedDays` check-ins están TODOS fuera del rango habitual
 * (media ± 1,5 DE de los check-ins anteriores) en la dirección desfavorable.
 */
export function sustainedChanges(entries: VasEntry[]): SustainedChange[] {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day)).slice(-TREND_RULES.windowDays);
  const recent = sorted.slice(-TREND_RULES.sustainedDays);
  const base = sorted.slice(0, -TREND_RULES.sustainedDays);
  if (recent.length < TREND_RULES.sustainedDays) return [];
  const out: SustainedChange[] = [];
  for (const d of VAS_DIMENSIONS) {
    const b = base.map((e) => e.vas[d]).filter((v): v is number => v !== undefined);
    const r = recent.map((e) => e.vas[d]).filter((v): v is number => v !== undefined);
    if (b.length < TREND_RULES.minBaseline || r.length < TREND_RULES.sustainedDays) continue;
    const mean = b.reduce((x, y) => x + y, 0) / b.length;
    const sd = Math.max(TREND_RULES.minSd, Math.sqrt(b.reduce((x, y) => x + (y - mean) ** 2, 0) / b.length));
    const limit = HIGHER_IS_WORSE[d] ? mean + TREND_RULES.sdFactor * sd : mean - TREND_RULES.sdFactor * sd;
    const all = r.every((v) => (HIGHER_IS_WORSE[d] ? v > limit : v < limit));
    if (all) out.push({ dimension: d, baselineMean: Math.round(mean), recentMean: Math.round(r.reduce((x, y) => x + y, 0) / r.length) });
  }
  return out;
}

/** Rango habitual (media ± DE) para dibujarlo; null si aún no hay base. */
export function usualRange(entries: VasEntry[], d: VasDimension): { min: number; max: number } | null {
  const v = entries.map((e) => e.vas[d]).filter((x): x is number => x !== undefined);
  if (v.length < TREND_RULES.minBaseline) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.max(TREND_RULES.minSd, Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length));
  return { min: Math.max(0, Math.round(mean - sd)), max: Math.min(100, Math.round(mean + sd)) };
}
