/**
 * Tipos de `triage.js`, copiado TAL CUAL de `backend/src/engine/triage.js` (rama `backend`).
 * No edites el `.js`: se actualiza copiándolo de nuevo (ver INTEGRACION.md §11). Este archivo solo
 * describe su forma para TypeScript.
 */

/** Átomo del protocolo: `q` (respuesta), `ctx` (contexto de la sesión) o `field` (resultado). */
export type ProtocolCondition =
  | { any: ProtocolCondition[] }
  | { all: ProtocolCondition[] }
  | { q?: string; ctx?: string; field?: string; op: string; value: unknown }
  | null
  | undefined;

export type TriageQuestionType = 'boolean' | 'number' | 'choice' | 'multi_choice';

export interface TriageQuestion {
  code: string;
  scope: 'session' | 'assessment';
  type: TriageQuestionType | string;
  prompt: string;
  note?: string;
  module?: string;
  observable?: boolean;
  choices?: string[];
  condition?: ProtocolCondition;
  prefill?: Record<string, unknown>;
  next?: Record<string, string>;
  source?: string;
}

export interface TriageEscalationAction {
  level: string;
  priority: string;
}

export interface TriageDefinition {
  disclaimer?: string;
  start_question?: string;
  questions: TriageQuestion[];
  results: Record<string, { category: 'green' | 'yellow' | 'red' | 'black'; then: string }>;
  radiation_flag_rules?: { when: ProtocolCondition; flag: 'none' | 'possible' | 'probable'; source?: string }[];
  radiation_flag_default?: 'none' | 'possible' | 'probable';
  escalation_rules?: { when: ProtocolCondition; actions: TriageEscalationAction[] }[];
  attention_order?: {
    categories: string[];
    radiation_flags: string[];
    unassessed?: 'after_red' | string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/** Valor suelto o envuelto como lo guarda la API (`{ value }` / `{ choice }`). */
export type TriageAnswerInput = unknown;

export type TriageEngineResult =
  | {
      status: 'incomplete';
      pending: string;
      triage_category: 'green' | 'yellow' | 'red' | 'black' | null;
      path: string[];
    }
  | { status: 'stopped'; reason: string; path: string[] }
  | {
      status: 'completed';
      triage_category: 'green' | 'yellow' | 'red' | 'black';
      radiation_flag: 'none' | 'possible' | 'probable';
      escalations: TriageEscalationAction[];
      path: string[];
    };

export function evaluateAssessment(
  definition: TriageDefinition,
  answers?: Record<string, TriageAnswerInput>,
  context?: Record<string, unknown>,
): TriageEngineResult;

export function testCondition(
  cond: ProtocolCondition,
  scope: { answers: Record<string, unknown>; context: Record<string, unknown>; fields: Record<string, unknown> },
): boolean;
