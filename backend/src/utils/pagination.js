'use strict';

/**
 * Paginación por cursor opaco (?cursor=&limit= → { items, next_cursor }).
 * El cursor es base64url de un JSON con la clave de orden de la última fila; las fechas
 * viajan como texto de PostgreSQL (con microsegundos) para no saltar ni repetir filas.
 */
const { badRequest } = require('./httpError');

const encodeCursor = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Decodifica y valida con `isValid(obj)`; 400 si el cursor no sirve. */
function decodeCursor(cursor, isValid) {
  if (cursor === undefined) return null;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object' || !isValid(value)) throw new Error('cursor');
    return value;
  } catch {
    throw badRequest([{ field: 'cursor', issue: 'cursor inválido' }]);
  }
}

/** limit: entero 1–200, por defecto 50. Devuelve el problema o null. */
function limitIssue(raw) {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 200 ? null : 'debe ser un entero entre 1 y 200';
}

const parseLimit = (raw) => (raw === undefined ? 50 : Number(raw));

/** Corta la página (se pidió limit + 1) y arma next_cursor con `keyOf(última fila)`. */
function toPage(rows, limit, keyOf, map = (r) => r) {
  const page = rows.slice(0, limit);
  return {
    items: page.map(map),
    next_cursor: rows.length > limit ? encodeCursor(keyOf(page[page.length - 1])) : null,
  };
}

const isTimestampText = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

module.exports = { encodeCursor, decodeCursor, limitIssue, parseLimit, toPage, isTimestampText };
