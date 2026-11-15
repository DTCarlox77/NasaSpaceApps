'use strict';

/**
 * Azar determinista del simulador (puro).
 *
 * Cada valor sale de un generador propio sembrado con una clave (semilla + astronauta +
 * indicador + fecha): el mismo valor no depende del orden en que se generen los demás ni
 * del día en que se corra. Así, la misma semilla da los mismos datos y un día ya cargado
 * produce los mismos client_uuid (correr dos veces no duplica).
 */
const crypto = require('node:crypto');

const sha256 = (parts) => crypto.createHash('sha256').update(parts.join('|')).digest();

/** mulberry32: generador de 32 bits, rápido y suficiente para datos de demo. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generador para una clave: rng() en [0, 1) y ayudas para distribuciones. */
function rngFor(...parts) {
  const next = mulberry32(sha256(parts.map(String)).readUInt32BE(0));
  const rng = () => next();
  rng.uniform = (min, max) => min + (max - min) * next();
  rng.int = (min, max) => Math.floor(rng.uniform(min, max + 1));
  // Normal por Box-Muller (1 - u evita log(0)).
  rng.normal = (mean, sd) =>
    mean + sd * Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  rng.chance = (p) => next() < p;
  return rng;
}

/**
 * UUID determinista (formato RFC 9562 versión 8, "personalizada") a partir de la clave.
 * Pasa la validación de UUID del contrato y no choca con los UUID v4 de los dispositivos.
 */
function uuidFor(...parts) {
  const hex = sha256(['sim-uuid', ...parts.map(String)]).toString('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, decimals = 0) => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

module.exports = { rngFor, uuidFor, clamp, round };
