'use strict';

const env = require('../config/env');

function errorHandler(err, req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let code = err.code && typeof err.code === 'string' ? err.code : 'INTERNAL_ERROR';
  let message = err.expose || status < 500 ? err.message : 'Error interno del servidor';

  // JSON mal formado enviado al body parser
  if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'El cuerpo de la petición no es un JSON válido';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'El cuerpo de la petición excede el tamaño permitido';
  }

  if (status >= 500) {
    console.error('[error]', err);
  }

  res.status(status).json({
    error: {
      code,
      message,
      details: err.details ?? (env.nodeEnv === 'development' && status >= 500 ? err.message : null),
    },
  });
}

module.exports = errorHandler;
