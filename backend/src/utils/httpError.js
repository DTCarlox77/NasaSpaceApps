'use strict';

/**
 * Error con forma del contrato: { error: { code, message, details } }.
 * El errorHandler usa status, code, message y details.
 */
class HttpError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

const badRequest = (details, message = 'La petición tiene campos inválidos.') =>
  new HttpError(400, 'VALIDATION_ERROR', message, details);
const unauthenticated = (message = 'Inicia sesión para continuar.') =>
  new HttpError(401, 'UNAUTHENTICATED', message);
const forbidden = (details = null, message = 'Tu rol no tiene permiso para esta acción.') =>
  new HttpError(403, 'FORBIDDEN', message, details);
const notFound = (message = 'El recurso no existe.') => new HttpError(404, 'NOT_FOUND', message);
const conflict = (code, message, details = null) => new HttpError(409, code, message, details);

module.exports = { HttpError, badRequest, unauthenticated, forbidden, notFound, conflict };
