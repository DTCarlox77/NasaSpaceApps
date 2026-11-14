'use strict';

/**
 * Rate limit en memoria por ventana fija (sin dependencias). Suficiente para una
 * sola instancia; con varias instancias haría falta un almacén compartido.
 * Responde 429 RATE_LIMITED con el header Retry-After.
 */
const env = require('../config/env');
const { HttpError } = require('../utils/httpError');

function createRateLimiter({ windowMs, max, keyFn = (req) => req.ip, now = Date.now }) {
  const hits = new Map();

  function prune(t) {
    for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key);
  }

  return function rateLimit(req, res, next) {
    const t = now();
    if (hits.size > 10000) prune(t);
    const key = keyFn(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - t) / 1000));
      res.set('Retry-After', String(retryAfter));
      throw new HttpError(429, 'RATE_LIMITED', 'Demasiados intentos. Espera unos segundos.', {
        retry_after_seconds: retryAfter,
      });
    }
    next();
  };
}

// Login: por IP. El bloqueo por cuenta (LOCKOUT_MAX_ATTEMPTS) protege cada usuario.
const loginRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: env.auth.loginRateLimitPerMinute,
});

module.exports = { createRateLimiter, loginRateLimit };
