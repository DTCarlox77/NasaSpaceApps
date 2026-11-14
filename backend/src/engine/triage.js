'use strict';

/**
 * Evaluador del protocolo de triaje (reglas como datos).
 * Función pura: la misma lógica corre en el servidor y puede portarse tal cual
 * a la app para funcionar sin conexión. Las condiciones se evalúan con
 * ./conditions (el mismo evaluador que usa el semáforo de indicadores).
 *
 * evaluateAssessment(definition, answers, context) -> {
 *   status: 'completed' | 'incomplete' | 'stopped',
 *   pending?: question_code,
 *   triage_category, radiation_flag, path, escalations
 * }
 *
 * answers: { [question_code]: valor | { value } | { choice } }  (la respuesta más reciente por pregunta)
 * context: { solar_event_active, environment_alarm, ... }
 */

const { evalCondition } = require('./conditions');

// Átomo del protocolo { q | ctx | field, op, value } -> ruta en el contexto de conditions.js.
// El orden define la prioridad si un átomo trae más de un operando.
const OPERAND_ROOTS = [
  ['q', 'answers'],
  ['ctx', 'ctx'],
  ['field', 'results'],
];

function toCommon(cond) {
  if (!cond) return { all: [] }; // condición nula = verdadera
  if (Array.isArray(cond.all)) return { all: cond.all.map(toCommon) };
  if (Array.isArray(cond.any)) return { any: cond.any.map(toCommon) };
  const operand = OPERAND_ROOTS.find(([key]) => key in cond);
  if (!operand) throw new Error(`Condición sin operando: ${JSON.stringify(cond)}`);
  const [key, root] = operand;
  return { field: `${root}.${cond[key]}`, op: cond.op, value: cond.value };
}

function testCondition(cond, scope) {
  return evalCondition(toCommon(cond), {
    answers: scope.answers,
    ctx: scope.context,
    results: scope.fields,
  });
}

// La API guarda cada respuesta como { value } (o { choice } en preguntas de opción);
// el dispositivo puede mandarla suelta. El motor trabaja siempre con el valor suelto.
function unwrapAnswer(answer) {
  if (answer && typeof answer === 'object' && !Array.isArray(answer)) {
    if ('value' in answer) return answer.value;
    if ('choice' in answer) return answer.choice;
  }
  return answer;
}

function nextFor(question, value) {
  const next = question.next || {};
  if (question.type === 'boolean') return next[String(value)];
  return next[value] ?? next['*'];
}

function evaluateAssessment(definition, answers = {}, context = {}) {
  const byCode = Object.fromEntries(definition.questions.map((q) => [q.code, q]));
  const start =
    definition.start_question || definition.questions.find((q) => q.scope === 'assessment')?.code;
  // Solo cuentan las respuestas de preguntas por las que pasó el recorrido: si un módulo
  // se omite (p. ej. radiación sin evento solar), sus respuestas no disparan reglas.
  const scope = { answers: {}, context, fields: {} };
  const path = [];
  let category = null;
  let current = start;
  let guard = 0;

  while (current && current !== 'END_ASSESSMENT') {
    if (++guard > 50) throw new Error('Protocolo con ciclo: revisa los campos next');

    if (current.startsWith('STOP_')) {
      return { status: 'stopped', reason: current, path };
    }

    if (current.startsWith('RESULT_')) {
      const result = definition.results[current];
      if (!result) throw new Error(`Resultado inexistente: ${current}`);
      category = result.category;
      path.push(current);
      current = result.then;
      continue;
    }

    const question = byCode[current];
    if (!question) throw new Error(`Pregunta inexistente: ${current}`);

    // Un módulo condicional (p. ej. radiación) se omite si su condición no aplica.
    if (question.condition && !testCondition(question.condition, scope)) {
      path.push(`${current}:omitida`);
      break;
    }

    const value = unwrapAnswer(answers[current]);
    if (value === undefined || value === null) {
      return { status: 'incomplete', pending: current, triage_category: category, path };
    }

    scope.answers[current] = value;
    path.push(`${current}=${JSON.stringify(value)}`);
    current = nextFor(question, value);
    if (!current) throw new Error(`Respuesta sin rama definida en ${question.code}: ${JSON.stringify(value)}`);
  }

  if (!category) throw new Error('El recorrido terminó sin categoría de triaje');

  const flagRule = (definition.radiation_flag_rules || []).find((r) => testCondition(r.when, scope));
  const radiationFlag = flagRule ? flagRule.flag : definition.radiation_flag_default || 'none';

  scope.fields = { category, radiation_flag: radiationFlag };
  const escRule = (definition.escalation_rules || []).find((r) => testCondition(r.when, scope));

  return {
    status: 'completed',
    triage_category: category,
    radiation_flag: radiationFlag,
    escalations: escRule ? escRule.actions : [],
    path,
  };
}

module.exports = { evaluateAssessment, testCondition };
