'use strict';

/**
 * Registro de peticiones (morgan): método, ruta sin los valores de la query, estado, tiempo y
 * tamaño. Nunca headers (Authorization, X-Device-Credential) ni bodies (contraseñas, PIN,
 * lecturas). Ver src/utils/safeLog.js.
 */
const morgan = require('morgan');
const { safeUrl } = require('../utils/safeLog');

morgan.token('safe-url', (req) => safeUrl(req.originalUrl || req.url));

const FORMAT = ':method :safe-url :status :response-time ms - :res[content-length]';

function requestLogger({ stream = process.stdout, skip } = {}) {
  return morgan(FORMAT, { stream, skip });
}

module.exports = { requestLogger, FORMAT };
