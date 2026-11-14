'use strict';

/**
 * Evaluador del protocolo de triaje (reglas como datos).
 * Función pura, sin dependencias: la misma lógica corre en el servidor
 * y puede portarse tal cual a la app para funcionar sin conexión.
 *
 * evaluateAssessment(definition, answers, context) -> {
 *   status: 'completed' | 'incomplete' | 'stopped',
 *   pending?: question_code,
 *   triage_category, radiation_flag, path, escalations
 * }
 *
 * answers: { [question_code]: valor }  (la respuesta más reciente por pregunta)
 * context: { solar_event_active, environment_alarm, ... }
 */

function readOperand(atom, scope) {
  if ('q' in atom) return scope.answers[atom.q];
  if ('ctx' in atom) return scope.context[atom.ctx];
  if ('field' in atom) return scope.fields[atom.field];
  throw new Error(`Condición sin operando: ${JSON.stringify(atom)}`);
}

function testAtom(atom, scope) {
  const left = readOperand(atom, scope);
  switch (atom.op) {
    case 'eq':
      return left === atom.value;
    case 'in':
      return Array.isArray(atom.value) && atom.value.includes(left);
    case 'has_any':
      return Array.isArray(left) && left.some((v) => atom.value.includes(v));
    default:
      throw new Error(`Operador no soportado: ${atom.op}`);
  }
}

function testCondition(cond, scope) {
  if (!cond) return true;
  if (cond.all) return cond.all.every((c) => testCondition(c, scope));
  if (cond.any) return cond.any.some((c) => testCondition(c, scope));
  return testAtom(cond, scope);
}

function nextFor(question, value) {
  const next = question.next || {};
  if (question.type === 'boolean') return next[String(value)];
  return next[value] ?? next['*'];
}

function evaluateAssessment(definition, answers = {}, context = {}) {
  const byCode = Object.fromEntries(definition.questions.map((q) => [q.code, q]));
  const start = definition.questions.find((q) => q.scope === 'assessment');
  const scope = { answers, context, fields: {} };
  const path = [];
  let category = null;
  let current = start.code;
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

    const value = answers[current];
    if (value === undefined) {
      return { status: 'incomplete', pending: current, triage_category: category, path };
    }

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