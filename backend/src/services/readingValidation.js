'use strict';

/**
 * Validación de los componentes de una lectura contra el catálogo (pura).
 * - Requeridos, tipos (number, integer, boolean, string, string[]) y componentes desconocidos.
 * - Valores enumerados ("work | sleep"), rangos ("0–3") y códigos del catálogo de síntomas.
 * - Unidades: el valor debe estar en la unidad del catálogo. Los rangos de PLAUSIBLE son una
 *   regla de diseño (no una fuente clínica): sirven para detectar errores de unidad, por
 *   ejemplo °F en vez de °C o lb en vez de kg. No deciden el semáforo.
 */

const PLAUSIBLE = Object.freeze({
  'BLOOD_PRESSURE.systolic': [40, 300],
  'BLOOD_PRESSURE.diastolic': [20, 200],
  'HEART_RATE.value': [20, 250],
  'RESP_RATE.value': [2, 80],
  'SPO2.value': [50, 100],
  'BODY_TEMP.value': [25, 45],
  'GLUCOSE.value': [10, 1000],
  'SLEEP_HOURS.value': [0, 24],
  'RAD_DOSE_DAILY.value': [0, 10000],
  'RAD_DOSE_CUM.value': [0, 10000],
  'BODY_MASS.value': [20, 300],
  'EXERCISE_MIN.value': [0, 1440],
  'HAB_CO2.value': [0, 100],
  'HAB_TEMP.value': [-10, 60],
  'HAB_HUMIDITY.value': [0, 100],
  'HAB_NOISE.value': [0, 150],
});

const enumOf = (values) => {
  if (typeof values !== 'string' || !values.includes('|')) return null;
  const parts = values.split('|').map((p) => p.trim());
  return parts.every((p) => /^[a-z_]+$/.test(p)) ? parts : null;
};

const rangeOf = (values) => {
  const match = /^(\d+)\s*[–-]\s*(\d+)$/.exec(typeof values === 'string' ? values.trim() : '');
  return match ? [Number(match[1]), Number(match[2])] : null;
};

const SYMPTOM_VALUES = /síntomas/i;

function checkType(component, value) {
  switch (component.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'debe ser un número';
    case 'integer':
      return Number.isInteger(value) ? null : 'debe ser un entero';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'debe ser true o false';
    case 'string':
      return typeof value === 'string' && value.length > 0 && value.length <= 100
        ? null
        : 'debe ser texto (1 a 100 caracteres)';
    case 'string[]':
      return Array.isArray(value) && value.length <= 50 && value.every((x) => typeof x === 'string')
        ? null
        : 'debe ser una lista de textos';
    default:
      return null;
  }
}

/**
 * Devuelve la lista de problemas [{ field, issue }] (vacía si es válida).
 * fieldPrefix = 'values' en POST /readings.
 */
function validateComponents(indicator, values, { symptomCodes, fieldPrefix = 'values' } = {}) {
  const problems = [];
  const field = (name) => `${fieldPrefix}.${name}`;
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return [{ field: fieldPrefix, issue: 'debe ser un objeto con los componentes del indicador' }];
  }
  const known = new Map(indicator.components.map((c) => [c.name, c]));
  for (const key of Object.keys(values)) {
    if (!known.has(key))
      problems.push({ field: field(key), issue: `no es un componente de ${indicator.code}` });
  }
  for (const component of indicator.components) {
    const value = values[component.name];
    if (value === undefined || value === null) {
      if (component.required)
        problems.push({ field: field(component.name), issue: 'es obligatorio' });
      continue;
    }
    const typeIssue = checkType(component, value);
    if (typeIssue) {
      problems.push({ field: field(component.name), issue: typeIssue });
      continue;
    }
    const allowed = enumOf(component.values);
    if (allowed && !allowed.includes(value)) {
      problems.push({
        field: field(component.name),
        issue: `debe ser uno de: ${allowed.join(', ')}`,
      });
    }
    const range = rangeOf(component.values);
    if (range && (value < range[0] || value > range[1])) {
      problems.push({
        field: field(component.name),
        issue: `debe estar entre ${range[0]} y ${range[1]}`,
      });
    }
    if (
      component.type === 'string[]' &&
      SYMPTOM_VALUES.test(component.values || '') &&
      symptomCodes
    ) {
      const unknown = value.filter((code) => !symptomCodes.has(code));
      if (unknown.length) {
        problems.push({
          field: field(component.name),
          issue: `síntomas desconocidos: ${unknown.join(', ')}`,
        });
      }
    }
    const plausible = PLAUSIBLE[`${indicator.code}.${component.name}`];
    if (plausible && (value < plausible[0] || value > plausible[1])) {
      problems.push({
        field: field(component.name),
        issue: `fuera de rango para ${component.unit || indicator.unit} (${plausible[0]}–${plausible[1]}); revisa la unidad`,
      });
    }
  }
  return problems;
}

/** measured_at válido (ISO 8601) y no en el futuro (5 min de tolerancia de reloj). */
function measuredAtIssue(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
    return 'debe ser una fecha ISO 8601 en UTC';
  if (Date.parse(value) > Date.now() + 5 * 60 * 1000) return 'no puede estar en el futuro';
  return null;
}

module.exports = { validateComponents, measuredAtIssue, PLAUSIBLE };
