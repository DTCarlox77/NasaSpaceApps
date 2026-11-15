'use strict';

/**
 * Piezas puras del triaje en el servidor (sin E/S): orden de atención, roster de evaluación,
 * prellenado desde lecturas, validación de respuestas de vocabulario cerrado y comparación
 * dispositivo/servidor. El resultado clínico lo da siempre evaluateAssessment
 * (src/engine/triage.js), el mismo evaluador que corre la app sin conexión.
 */

// Orden de START (inmediato, diferido, leve, expectante) si el protocolo no trae el suyo (v1).
const DEFAULT_ATTENTION = Object.freeze({
  categories: ['red', 'yellow', 'green', 'black'],
  radiation_flags: ['probable', 'possible', 'none'],
  unassessed: 'after_red',
});

const CATEGORY_LABEL = {
  red: 'Rojo (inmediato)',
  yellow: 'Amarillo (diferido)',
  green: 'Verde (leve)',
  black: 'Negro (expectante)',
};
const FLAG_LABEL = {
  probable: 'radiación probable (vómito)',
  possible: 'radiación posible (síntomas prodrómicos)',
};
const PRIORITY_RANK = { routine: 0, urgent: 1, emergency: 2 };

const riskRank = (risks, id) => (risks.has(id) ? risks.get(id).rank : 99);

/** La prioridad mayor de las acciones (para el campo priority del contrato). */
function maxPriority(actions = []) {
  return actions.reduce(
    (best, a) =>
      best === null || PRIORITY_RANK[a.priority] > PRIORITY_RANK[best] ? a.priority : best,
    null,
  );
}

/** La evaluación vigente de cada tripulante: la última completada (reevaluación manda). */
function currentAssessments(assessments) {
  const byAstronaut = new Map();
  for (const a of assessments) {
    const prev = byAstronaut.get(a.astronaut_id);
    const key = (x) => [x.status === 'completed' ? 1 : 0, new Date(x.completed_at || x.started_at)];
    if (!prev) byAstronaut.set(a.astronaut_id, a);
    else {
      const [pc, pt] = key(prev);
      const [ac, at] = key(a);
      if (ac > pc || (ac === pc && at >= pt)) byAstronaut.set(a.astronaut_id, a);
    }
  }
  return byAstronaut;
}

/**
 * Orden de atención de toda la tripulación según el protocolo (attention_order), con el
 * motivo de cada lugar. risks: Map astronaut_id → { reason, rank } (rank 0 = más urgente:
 * no respondió "estoy bien"; luego esperando respuesta; luego lectura crítica reciente).
 */
function attentionOrder({ crew, assessments, protocol, risks = new Map() }) {
  const order = (protocol && protocol.attention_order) || DEFAULT_ATTENTION;
  const current = currentAssessments(assessments);
  const rows = crew.map((member) => {
    const a = current.get(member.astronaut_id);
    const assessed = a && a.status === 'completed';
    return { member, a, assessed };
  });
  const catIndex = (c) => {
    const i = order.categories.indexOf(c);
    return i < 0 ? order.categories.length : i;
  };
  const flagIndex = (f) => {
    const i = order.radiation_flags.indexOf(f || 'none');
    return i < 0 ? order.radiation_flags.length : i;
  };
  // Posición de los no evaluados: después de los rojos (puede ser rojo) o al final.
  const unassessedSlot =
    order.unassessed === 'after_red' ? catIndex('red') + 0.5 : order.categories.length + 1;
  const sortKey = (r) =>
    r.assessed
      ? [catIndex(r.a.triage_category), flagIndex(r.a.radiation_flag), new Date(r.a.completed_at)]
      : [unassessedSlot, riskRank(risks, r.member.astronaut_id), r.member.call_sign];
  rows.sort((x, y) => {
    const kx = sortKey(x);
    const ky = sortKey(y);
    for (let i = 0; i < kx.length; i += 1) {
      if (kx[i] < ky[i]) return -1;
      if (kx[i] > ky[i]) return 1;
    }
    return x.member.call_sign.localeCompare(y.member.call_sign);
  });
  return rows.map((r, i) => {
    const risk = risks.get(r.member.astronaut_id);
    let reason;
    if (r.assessed) {
      reason = CATEGORY_LABEL[r.a.triage_category] || r.a.triage_category;
      if (FLAG_LABEL[r.a.radiation_flag]) reason += `, ${FLAG_LABEL[r.a.radiation_flag]}`;
      if (r.a.matches_device === false)
        reason += '. La tableta calculó otra cosa: manda la del servidor';
    } else {
      reason =
        r.a && r.a.status === 'in_progress'
          ? 'Evaluación en curso: termínala (puede ser rojo)'
          : 'Sin evaluar: evalúalo (puede ser rojo)';
      if (risk) reason += `. ${risk.reason}`;
    }
    return {
      position: i + 1,
      astronaut_id: r.member.astronaut_id,
      call_sign: r.member.call_sign,
      status: r.assessed ? 'assessed' : r.a ? 'in_progress' : 'unassessed',
      assessment_id: r.a ? r.a.id : null,
      triage_category: r.assessed ? r.a.triage_category : null,
      radiation_flag: r.assessed ? r.a.radiation_flag : null,
      matches_device: r.assessed ? r.a.matches_device : null,
      reason,
    };
  });
}

/** Roster de evaluación: primero quien tiene un riesgo conocido; luego el resto. */
function roster({ crew, risks = new Map(), prefill = new Map() }) {
  const sorted = [...crew].sort(
    (x, y) =>
      riskRank(risks, x.astronaut_id) - riskRank(risks, y.astronaut_id) ||
      x.call_sign.localeCompare(y.call_sign),
  );
  return sorted.map((m, i) => ({
    astronaut_id: m.astronaut_id,
    call_sign: m.call_sign,
    crew_role: m.crew_role,
    sequence_no: i + 1,
    priority_reason: risks.has(m.astronaut_id) ? risks.get(m.astronaut_id).reason : null,
    prefill: prefill.get(m.astronaut_id) || {},
  }));
}

/** Regla de prellenado "value > 30" (las del protocolo); null si no se puede aplicar. */
function applyPrefillRule(rule, components) {
  const match = /^value\s*(>=|<=|>|<|==)\s*(-?\d+(?:\.\d+)?)$/.exec(String(rule || '').trim());
  if (!match || !components || typeof components.value !== 'number') return null;
  const [, op, raw] = match;
  const n = Number(raw);
  const v = components.value;
  return { '>': v > n, '>=': v >= n, '<': v < n, '<=': v <= n, '==': v === n }[op];
}

/** Preguntas con prellenado desde una lectura reciente que el servidor sabe calcular. */
const prefillQuestions = (definition) =>
  definition.questions.filter(
    (q) => q.prefill && q.prefill.from === 'reading' && q.prefill.indicator && q.prefill.rule,
  );

/**
 * Valida una respuesta contra la pregunta del protocolo (vocabulario cerrado). Devuelve el
 * problema o null. boolean → { value: true|false }; choice → { choice: <código> };
 * multi_choice → { choice: [códigos] }.
 */
function answerIssue(question, answer) {
  if (!question) return 'no es una pregunta del protocolo';
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    return 'debe ser { "value": … } o { "choice": … }';
  }
  if (question.type === 'boolean') {
    return typeof answer.value === 'boolean' ? null : 'debe ser { "value": true | false }';
  }
  if (question.type === 'number') {
    return typeof answer.value === 'number' && Number.isFinite(answer.value)
      ? null
      : 'debe ser { "value": <número> }';
  }
  const choices = question.choices || [];
  if (question.type === 'choice') {
    return choices.includes(answer.choice) ? null : `debe ser { "choice": ${choices.join(' | ')} }`;
  }
  if (question.type === 'multi_choice') {
    const list = answer.choice;
    if (!Array.isArray(list) || !list.length || !list.every((c) => choices.includes(c))) {
      return `debe ser { "choice": [${choices.join(', ')}] }`;
    }
    if (list.includes('none') && list.length > 1) return '"none" no va con otras opciones';
    return null;
  }
  return `tipo de pregunta no soportado: ${question.type}`;
}

/** Respuesta más reciente por pregunta (answered_at; a igual hora, la última recibida). */
function latestAnswers(rows) {
  const out = {};
  const at = {};
  for (const r of rows) {
    const t = new Date(r.answered_at).getTime();
    if (at[r.question_code] === undefined || t >= at[r.question_code]) {
      out[r.question_code] = r.answer;
      at[r.question_code] = t;
    }
  }
  return out;
}

/** Compara lo que calculó la tableta con el servidor. Devuelve { matches, fields }. */
function compareDevice(device, server, protocolVersion) {
  if (!device || typeof device !== 'object') return { matches: null, fields: [] };
  const fields = [];
  if (device.status !== undefined && device.status !== server.status) fields.push('status');
  if (
    device.triage_category !== undefined &&
    device.triage_category !== (server.triage_category ?? null)
  ) {
    fields.push('triage_category');
  }
  if (
    device.radiation_flag !== undefined &&
    device.radiation_flag !== (server.radiation_flag ?? null)
  ) {
    fields.push('radiation_flag');
  }
  if (device.rules_version !== undefined && device.rules_version !== protocolVersion) {
    fields.push('rules_version');
  }
  return { matches: fields.length === 0, fields };
}

module.exports = {
  DEFAULT_ATTENTION,
  maxPriority,
  currentAssessments,
  attentionOrder,
  roster,
  applyPrefillRule,
  prefillQuestions,
  answerIssue,
  latestAnswers,
  compareDevice,
};
