import { evaluateIndicator, type Condition, type IndicatorEvaluation, type IndicatorRule } from '@/core/engine/conditions';

/** Campos que usan las condiciones de las reglas (recorre grupos any/all anidados). */
export function fieldsOf(rules: IndicatorRule[]): Set<string> {
  const out = new Set<string>();
  const walk = (c: Condition | undefined) => {
    if (!c || typeof c !== 'object') return;
    if ('any' in c && Array.isArray(c.any)) c.any.forEach(walk);
    else if ('all' in c && Array.isArray(c.all)) c.all.forEach(walk);
    else if ('field' in c) out.add(String(c.field).split('.')[0]!);
  };
  rules.forEach((r) => walk(r.when));
  return out;
}

/**
 * Evalúa una lectura SIN conexión con las reglas guardadas (GET /rules) y el mismo `conditions.js` del
 * servidor. El contexto es el del servidor (`ruleContext` de evaluation.service.js): componentes de la
 * lectura + `sex` del perfil (si lo hay) + derivados. La app NO calcula derivados (necesitan el historial
 * del servidor): si alguna regla del indicador usa un campo derivado, devuelve null ("sin evaluar"),
 * nunca adivina. También null si no hay reglas o catálogo guardados, o si el indicador es confidencial.
 */
export function evaluateReadingOffline(input: {
  code: string;
  values: Record<string, unknown>;
  sex?: string | null;
  rules: { rules_version: number; rules: IndicatorRule[] } | undefined;
  /** `derived_fields` del catálogo; null = catálogo no disponible (no se puede saber cuáles son derivados). */
  derivedFields: string[] | null;
  sensitivity?: 'standard' | 'confidential';
}): IndicatorEvaluation | null {
  const { code, values, sex, rules, derivedFields } = input;
  if (!rules || !rules.rules.length || derivedFields === null) return null;
  if (input.sensitivity && input.sensitivity !== 'standard') return null;
  const used = fieldsOf(rules.rules);
  if (derivedFields.some((f) => used.has(f))) return null;
  const ctx = { ...(sex ? { sex } : {}), ...values };
  return evaluateIndicator({ code, rules: rules.rules, rules_version: rules.rules_version }, ctx);
}
