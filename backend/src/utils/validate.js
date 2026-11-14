'use strict';

/**
 * Validación mínima de bodies sin dependencias. Acumula los problemas y lanza un
 * 400 VALIDATION_ERROR con details = [{ field, issue }], como pide el contrato.
 */
const { badRequest } = require('./httpError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

class Validator {
  constructor(body) {
    this.body = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    this.problems = [];
  }

  add(field, issue) {
    this.problems.push({ field, issue });
    return this;
  }

  get(field) {
    return field.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), this.body);
  }

  string(field, { required = true, min = 1, max = 500, pattern, patternIssue } = {}) {
    const value = this.get(field);
    if (value === undefined || value === null) {
      if (required) this.add(field, 'es obligatorio');
      return this;
    }
    if (typeof value !== 'string') return this.add(field, 'debe ser texto');
    if (value.length < min || value.length > max) {
      return this.add(field, `debe tener entre ${min} y ${max} caracteres`);
    }
    if (pattern && !pattern.test(value)) this.add(field, patternIssue || 'formato inválido');
    return this;
  }

  email(field, { required = false } = {}) {
    const value = this.get(field);
    if (value === undefined || value === null) {
      if (required) this.add(field, 'es obligatorio');
      return this;
    }
    if (typeof value !== 'string' || !EMAIL_RE.test(value) || value.length > 254) {
      this.add(field, 'debe ser un correo válido');
    }
    return this;
  }

  uuid(field, { required = true } = {}) {
    const value = this.get(field);
    if (value === undefined || value === null) {
      if (required) this.add(field, 'es obligatorio');
      return this;
    }
    if (!isUuid(value)) this.add(field, 'debe ser un UUID');
    return this;
  }

  oneOf(field, values, { required = true } = {}) {
    const value = this.get(field);
    if (value === undefined || value === null) {
      if (required) this.add(field, 'es obligatorio');
      return this;
    }
    if (!values.includes(value)) this.add(field, `debe ser uno de: ${values.join(', ')}`);
    return this;
  }

  boolean(field, { required = false } = {}) {
    const value = this.get(field);
    if (value === undefined || value === null) {
      if (required) this.add(field, 'es obligatorio');
      return this;
    }
    if (typeof value !== 'boolean') this.add(field, 'debe ser true o false');
    return this;
  }

  uuidArray(field, { required = false, max = 50 } = {}) {
    const value = this.get(field);
    if (value === undefined || value === null) {
      if (required) this.add(field, 'es obligatorio');
      return this;
    }
    if (!Array.isArray(value) || value.length > max || !value.every(isUuid)) {
      this.add(field, `debe ser una lista de hasta ${max} UUID`);
    }
    return this;
  }

  /** Lanza el 400 si hubo problemas. */
  check() {
    if (this.problems.length > 0) throw badRequest(this.problems);
    return this.body;
  }
}

const validate = (body) => new Validator(body);

/** Valida un parámetro de ruta UUID (400 si no lo es). */
function uuidParam(value, name = 'id') {
  if (!isUuid(value)) throw badRequest([{ field: name, issue: 'debe ser un UUID' }]);
  return value;
}

module.exports = { validate, uuidParam, isUuid };
