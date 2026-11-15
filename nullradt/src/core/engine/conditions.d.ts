/**
 * Tipos de `conditions.js`, copiado TAL CUAL de `backend/src/engine/conditions.js` (rama `backend`).
 * No edites el `.js`: se actualiza copiándolo de nuevo (ver INTEGRACION.md §11). Este archivo solo
 * describe su forma para TypeScript.
 */

export type ConditionOp = 'eq' | 'in' | 'has_any' | 'lt' | 'lte' | 'gt' | 'gte' | 'between';

export type Condition =
  | { any: Condition[] }
  | { all: Condition[] }
  | { field: string; op: ConditionOp | string; value: unknown };

export type RuleLevel = 'normal' | 'caution' | 'critical' | 'unrated';
export type RuleEscalation = 'self_care' | 'crew' | 'behavioral_health' | 'flight_surgeon';

export interface IndicatorRule {
  level: RuleLevel;
  when: Condition;
  recommendation?: string;
  escalation?: RuleEscalation;
  basis?: string;
  source_ids?: string[];
  note?: string;
}

export interface IndicatorEvaluation {
  code: string;
  level: RuleLevel;
  rule_index: number;
  rules_version?: number;
  recommendation?: string;
  escalation?: RuleEscalation;
  basis?: string;
  source_ids?: string[];
}

export const OPS: Record<string, (a: unknown, b: unknown) => boolean>;
export const LEVEL_ORDER: Record<RuleLevel, number>;
export const ESCALATION_ORDER: Record<RuleEscalation, number>;
export function evalCondition(cond: Condition, ctx: Record<string, unknown>): boolean;
export function evaluateIndicator(
  indicator: { code: string; rules?: IndicatorRule[]; rules_version?: number },
  ctx: Record<string, unknown>,
): IndicatorEvaluation;
export function fitnessFromPvt(results: { level: string }[]): 'fit' | 'not_confirmed';
