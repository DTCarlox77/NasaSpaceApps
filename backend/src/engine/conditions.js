'use strict';
/**
 * Evaluador puro de condiciones para "reglas como datos".
 * Lo usan el semáforo de indicadores y el triaje (mismo código en dispositivo y servidor).
 *
 * Condición hoja:  { field: 'systolic', op: 'gt', value: 180 }
 * Grupo:           { any: [cond, ...] }  |  { all: [cond, ...] }   (anidables)
 * Grupo vacío { all: [] } = verdadero (regla por defecto).
 * Campo ausente (undefined/null) => la condición hoja es falsa.
 */

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

const OPS = {
  eq: (a, b) => a === b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
  has_any: (a, b) => Array.isArray(a) && Array.isArray(b) && b.some((x) => a.includes(x)),
  lt: (a, b) => isNum(a) && isNum(b) && a < b,
  lte: (a, b) => isNum(a) && isNum(b) && a <= b,
  gt: (a, b) => isNum(a) && isNum(b) && a > b,
  gte: (a, b) => isNum(a) && isNum(b) && a >= b,
  between: (a, b) => isNum(a) && Array.isArray(b) && b.length === 2 && a >= b[0] && a <= b[1],
};

const LEVEL_ORDER = { unrated: 0, normal: 1, caution: 2, critical: 3 };
const ESCALATION_ORDER = { self_care: 0, crew: 1, behavioral_health: 2, flight_surgeon: 3 };

function getField(ctx, path) {
  return String(path)
    .split('.')
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), ctx);
}

function evalCondition(cond, ctx) {
  if (!cond || typeof cond !== 'object') throw new TypeError('Condición inválida');
  if (Array.isArray(cond.any)) return cond.any.some((c) => evalCondition(c, ctx));
  if (Array.isArray(cond.all)) return cond.all.every((c) => evalCondition(c, ctx));
  const fn = OPS[cond.op];
  if (!fn) throw new Error(`Operador no soportado: ${cond.op}`);
  const v = getField(ctx, cond.field);
  if (v === undefined || v === null) return false;
  return fn(v, cond.value);
}

/**
 * Evalúa un indicador del catálogo. Gana la primera regla que se cumple.
 * @param {object} indicator  objeto del catálogo (code, rules[])
 * @param {object} ctx        componentes de la lectura + campos derivados
 */
function evaluateIndicator(indicator, ctx) {
  const rules = indicator.rules || [];
  for (let i = 0; i < rules.length; i += 1) {
    const r = rules[i];
    if (evalCondition(r.when, ctx)) {
      return {
        code: indicator.code,
        level: r.level,
        rule_index: i,
        rules_version: indicator.rules_version,
        recommendation: r.recommendation,
        escalation: r.escalation,
        basis: r.basis,
        source_ids: r.source_ids,
      };
    }
  }
  return { code: indicator.code, level: 'unrated', rule_index: -1, escalation: 'self_care' };
}

/** Aptitud para tarea crítica a partir de los resultados PVT (solo esto llega a admin). */
function fitnessFromPvt(results) {
  const ok = results.length > 0 && results.every((r) => r.level === 'normal');
  return ok ? 'fit' : 'not_confirmed';
}

module.exports = { OPS, LEVEL_ORDER, ESCALATION_ORDER, evalCondition, evaluateIndicator, fitnessFromPvt };
