'use strict';

/**
 * Middlewares de autenticación y permisos.
 * - authenticate(): valida el JWT, la versión de la contraseña y el estado de la cuenta.
 * - authenticateUserOrDevice(): Bearer o X-Device-Credential (solo rutas del triaje).
 * - requireRole(...roles) y requireCrewRole(...crewRoles) (este último lee v_current_crew).
 * - restrictServiceAccounts: el rol `service` solo pasa a POST /api/v1/habitat/readings.
 * - Con must_change_password (o un token del 428) solo se puede cambiar la contraseña
 *   o cerrar sesión: el resto responde 428.
 */
const { HttpError, unauthenticated, forbidden } = require('../utils/httpError');
const tokens = require('../services/tokens.service');
const users = require('../models/users.model');
const contextModel = require('../models/userContext.model');
const { passwordChangeRequired } = require('../services/auth.service');
const devicesService = require('../services/devices.service');

// Lista blanca explícita del rol service (método + ruta exacta).
const SERVICE_ALLOWED = Object.freeze([{ method: 'POST', path: '/api/v1/habitat/readings' }]);

const requestPath = (req) => req.originalUrl.split('?')[0].replace(/\/+$/, '') || '/';

function isServiceAllowed(req) {
  const path = requestPath(req);
  return SERVICE_ALLOWED.some((r) => r.method === req.method && r.path === path);
}

const serviceForbidden = () =>
  forbidden(
    { allowed: SERVICE_ALLOWED.map((r) => `${r.method} ${r.path}`) },
    'La cuenta de servicio solo puede registrar lecturas del hábitat.',
  );

function bearerToken(req) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
  return match ? match[1] : null;
}

function readClaims(req) {
  const token = bearerToken(req);
  if (!token) return null;
  try {
    return tokens.verify(token);
  } catch {
    return undefined;
  }
}

/**
 * Global (antes de las rutas): si el token es de una cuenta de servicio y la ruta no
 * está en la lista blanca → 403, incluso si la ruta no existe. No exige token.
 */
function restrictServiceAccounts(req, _res, next) {
  const claims = readClaims(req);
  if (claims && claims.role === 'service' && !isServiceAllowed(req)) throw serviceForbidden();
  next();
}

function authenticate({ allowPasswordChange = false } = {}) {
  return async function authenticateRequest(req, _res, next) {
    const claims = readClaims(req);
    if (claims === null) throw unauthenticated();
    if (claims === undefined) throw unauthenticated('La sesión expiró o el token no es válido.');
    if (claims.scope !== 'access' && claims.scope !== 'password_change') throw unauthenticated();

    const user = await users.findById(claims.sub);
    if (!user || !user.is_active || claims.pcv !== tokens.passwordVersion(user)) {
      throw unauthenticated('La sesión ya no es válida. Inicia sesión de nuevo.');
    }

    req.auth = {
      userId: user.id,
      username: user.username,
      role: user.role,
      deviceId: claims.did,
      scope: claims.scope,
    };

    if (user.role === 'service' && !isServiceAllowed(req)) throw serviceForbidden();
    if ((claims.scope === 'password_change' || user.must_change_password) && !allowPasswordChange) {
      throw passwordChangeRequired(user, claims.did);
    }
    next();
  };
}

function requireRole(...roles) {
  return function requireRoleMiddleware(req, _res, next) {
    if (!req.auth) throw unauthenticated();
    if (!roles.includes(req.auth.role)) throw forbidden({ required_roles: roles });
    next();
  };
}

/**
 * Rutas del triaje (tarea 11): sesión de usuario (Bearer) o tableta registrada sin sesión
 * (X-Device-Credential). Con Bearer manda el usuario. Con la credencial deja req.device =
 * { id, label, mission_id } y req.auth = null. Fallos de credencial limitados por IP (429).
 * Solo se monta en las rutas de emergencia: en cualquier otra, la credencial no autentica
 * (authenticate() exige Bearer → 401).
 */
function authenticateUserOrDevice() {
  const asUser = authenticate();
  return async function authenticateUserOrDeviceRequest(req, res, next) {
    if (bearerToken(req)) return asUser(req, res, next);
    const credential = req.get('x-device-credential');
    if (!credential) throw unauthenticated();
    const retryAfter = devicesService.blockedFor(req.ip);
    if (retryAfter) {
      res.set('Retry-After', String(retryAfter));
      throw new HttpError(429, 'RATE_LIMITED', 'Demasiados intentos. Espera unos segundos.', {
        retry_after_seconds: retryAfter,
      });
    }
    req.auth = null;
    req.device = await devicesService.authenticate({ credential, ip: req.ip });
    next();
  };
}

/** requireRole que deja pasar a una tableta ya autenticada (req.device). */
function requireRoleOrDevice(...roles) {
  const byRole = requireRole(...roles);
  return function requireRoleOrDeviceMiddleware(req, res, next) {
    if (req.device) return next();
    return byRole(req, res, next);
  };
}

/** Exige un rol de tripulación vigente (v_current_crew). Deja la fila en req.crew. */
function requireCrewRole(...crewRoles) {
  return async function requireCrewRoleMiddleware(req, _res, next) {
    if (!req.auth) throw unauthenticated();
    const crew = await contextModel.currentCrew(req.auth.userId);
    if (!crew || !crewRoles.includes(crew.crew_role)) {
      throw forbidden(
        { required_crew_roles: crewRoles },
        'Esta acción requiere un rol de tripulación que no tienes.',
      );
    }
    req.crew = crew;
    next();
  };
}

module.exports = {
  authenticate,
  authenticateUserOrDevice,
  requireRoleOrDevice,
  requireRole,
  requireCrewRole,
  restrictServiceAccounts,
  SERVICE_ALLOWED,
};
