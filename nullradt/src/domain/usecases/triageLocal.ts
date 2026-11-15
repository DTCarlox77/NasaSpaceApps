import { evaluateAssessment, type TriageEngineResult } from '@/core/engine/triage';
import type {
  AttentionRow,
  CurrentAssessment,
  DeviceResult,
  LocalAnswer,
  LocalTriageSession,
  RadiationFlag,
  TriageAnswer,
  TriageCategory,
  TriageDefinition,
  TriageQuestion,
  TriageRosterEntry,
} from '../entities/Triage';

/**
 * Piezas puras del triaje en el dispositivo. La clasificación la da SIEMPRE `evaluateAssessment`
 * (src/core/engine/triage.js, copiado tal cual del backend); aquí solo se arma su entrada y se lee su salida.
 */

/** Respuestas para el evaluador: la más reciente por pregunta + responder_safe de la sesión. */
export function answersFor(session: Pick<LocalTriageSession, 'responderSafe' | 'responderSafeAnswer'>, answers: LocalAnswer[]) {
  const map: Record<string, TriageAnswer> = {};
  const at: Record<string, number> = {};
  const all = session.responderSafeAnswer ? [session.responderSafeAnswer, ...answers] : answers;
  for (const a of all) {
    const t = new Date(a.answeredAt).getTime();
    if (at[a.questionCode] === undefined || t >= at[a.questionCode]!) {
      map[a.questionCode] = a.answer;
      at[a.questionCode] = t;
    }
  }
  // Igual que el servidor: si la evaluación no trae responder_safe, se usa el de la sesión.
  if (map.responder_safe === undefined && session.responderSafe !== null && session.responderSafe !== undefined) {
    map.responder_safe = { value: session.responderSafe };
  }
  return map;
}

/** Corre el evaluador del protocolo con el contexto de la sesión (el mismo que usa el servidor). */
export function evaluateLocal(
  definition: TriageDefinition,
  session: Pick<LocalTriageSession, 'responderSafe' | 'responderSafeAnswer' | 'context'>,
  answers: LocalAnswer[],
): TriageEngineResult {
  return evaluateAssessment(definition, answersFor(session, answers), session.context ?? {});
}

/** `device_result` del complete a partir del resultado local. */
export function toDeviceResult(result: TriageEngineResult, rulesVersion: number): DeviceResult {
  if (result.status === 'completed') {
    return { status: 'completed', triage_category: result.triage_category, radiation_flag: result.radiation_flag, rules_version: rulesVersion };
  }
  return { status: result.status, ...(result.status === 'incomplete' && result.triage_category ? { triage_category: result.triage_category } : {}), rules_version: rulesVersion };
}

/** Preguntas por las que pasó el recorrido (solo esas respuestas cuentan y se envían). */
export function answeredOnPath(result: TriageEngineResult): string[] {
  return result.path.filter((p) => p.includes('=')).map((p) => p.split('=')[0]!);
}

export function questionByCode(definition: TriageDefinition, code: string): TriageQuestion | undefined {
  return definition.questions.find((q) => q.code === code);
}

/** Reemplaza {call_sign} del texto del protocolo. */
export const withCallSign = (text: string, callSign: string) => text.split('{call_sign}').join(callSign);

/**
 * Respuesta válida para la pregunta (vocabulario cerrado del protocolo, como lo valida el servidor):
 * boolean → { value: bool }; number → { value: n }; choice → { choice: código }; multi_choice → { choice: [códigos] }
 * ("none" no va con otras opciones). null = no es válida.
 */
export function buildAnswer(question: TriageQuestion, raw: boolean | number | string | string[]): TriageAnswer | null {
  const choices = question.choices ?? [];
  switch (question.type) {
    case 'boolean':
      return typeof raw === 'boolean' ? { value: raw } : null;
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw) ? { value: raw } : null;
    case 'choice':
      return typeof raw === 'string' && choices.includes(raw) ? { choice: raw } : null;
    case 'multi_choice': {
      const list = Array.isArray(raw) ? [...new Set(raw)] : typeof raw === 'string' ? [raw] : [];
      if (!list.length || !list.every((c) => choices.includes(c))) return null;
      if (list.includes('none') && list.length > 1) return null;
      return { choice: choices.filter((c) => list.includes(c)) };
    }
    default:
      return null;
  }
}

// Orden de START (inmediato, diferido, leve, expectante) cuando el protocolo no trae `attention_order`
// (mismo valor por defecto que usa el servidor para la v1).
const DEFAULT_ATTENTION = { categories: ['red', 'yellow', 'green', 'black'], radiation_flags: ['probable', 'possible', 'none'], unassessed: 'after_red' };

/**
 * Orden de atención calculado en la tableta SIN conexión, con la regla `attention_order` del protocolo
 * (la misma que aplica el servidor): categorías en el orden del protocolo, dentro de cada una radiación
 * probable antes que posible, y los que faltan por evaluar después de los rojos. El motivo en texto lo da
 * solo el servidor; al reconectar manda su `attention_order`.
 */
export function deviceAttentionOrder(
  definition: TriageDefinition | null,
  roster: TriageRosterEntry[],
  current: Record<string, CurrentAssessment>,
): AttentionRow[] {
  const order = (definition?.attention_order as typeof DEFAULT_ATTENTION | undefined) ?? DEFAULT_ATTENTION;
  const catIndex = (c: string | null) => {
    const i = c ? order.categories.indexOf(c) : -1;
    return i < 0 ? order.categories.length : i;
  };
  const flagIndex = (f: string | null) => {
    const i = order.radiation_flags.indexOf(f || 'none');
    return i < 0 ? order.radiation_flags.length : i;
  };
  const unassessedSlot = order.unassessed === 'after_red' ? catIndex('red') + 0.5 : order.categories.length + 1;
  const rows = roster.map((m) => {
    const a = current[m.astronautId];
    const assessed = a?.status === 'completed';
    const key: (number | string)[] = assessed
      ? [catIndex(a!.triageCategory), flagIndex(a!.radiationFlag), a!.completedAt ?? '']
      : [unassessedSlot, m.sequenceNo, m.callSign];
    return { m, a, assessed, key };
  });
  rows.sort((x, y) => {
    for (let i = 0; i < x.key.length; i += 1) {
      if (x.key[i]! < y.key[i]!) return -1;
      if (x.key[i]! > y.key[i]!) return 1;
    }
    return x.m.callSign.localeCompare(y.m.callSign);
  });
  return rows.map((r, i) => ({
    position: i + 1,
    astronautId: r.m.astronautId,
    callSign: r.m.callSign,
    status: r.assessed ? 'assessed' : r.a ? 'in_progress' : 'unassessed',
    triageCategory: r.assessed ? (r.a!.triageCategory as TriageCategory | null) : null,
    radiationFlag: r.assessed ? (r.a!.radiationFlag as RadiationFlag | null) : null,
    matchesDevice: r.assessed ? r.a!.matchesDevice : null,
    reason: null,
  }));
}
