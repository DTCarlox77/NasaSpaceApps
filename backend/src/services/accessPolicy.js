'use strict';

/**
 * Política de acceso y filtro de confidencialidad: el ÚNICO lugar donde se decide
 * quién puede ver o escribir datos de salud de un astronauta.
 *
 * REGLA: las consultas del panel (dashboard, bandejas, listados de Tierra) leen
 * SIEMPRE de la vista v_readings_standard, nunca de `readings` directo. Así un
 * indicador confidencial (bienestar) no puede filtrarse por un JOIN olvidado.
 *
 * canAccess(actor, resource) es pura (sin E/S): recibe los hechos ya resueltos.
 *   actor    = { user_id, username, role, astronaut_id, crew_role, mission_ids }
 *   resource = {
 *     astronaut_id,        // dueño del dato; null = dato del módulo (hábitat)
 *     mission_id,          // misión del dato
 *     sensitivity,         // 'standard' | 'confidential'
 *     category,            // 'physical' | 'behavioral' | 'emergency'
 *     action,              // 'read' | 'write'
 *     view,                // opcional: 'detail' (por defecto) | 'escalated_alert' | 'compliance' |
 *                          //           'fitness' | 'clinical_profile' (sexo biológico del perfil) |
 *                          //           'operational' (estado de una emergencia, sin datos clínicos) |
 *                          //           'crew_status' (pantalla "Tripulación": roster, emergencia
 *                          //           abierta y alertas físicas escaladas a bordo, sin valores) |
 *                          //           'crew_physical' (semáforo físico de un tripulante en esa
 *                          //           pantalla: solo el oficial médico)
 *     emergency_active,    // opcional: hay una emergencia activa del triaje en la misión
 *     share_with_cmo,      // opcional: privacy_preferences.share_with_cmo del dueño
 *   }
 */
const { pool } = require('../config/db');
const { fitnessFromPvt } = require('../engine/conditions');
const { forbidden } = require('../utils/httpError');
const users = require('../models/users.model');
const contextModel = require('../models/userContext.model');
const confidentialAccess = require('../models/confidentialAccess.model');

const SENSITIVITIES = ['standard', 'confidential'];
const CATEGORIES = ['physical', 'behavioral', 'emergency'];
const ACTIONS = ['read', 'write'];
const VIEWS = [
  'detail',
  'escalated_alert',
  'compliance',
  'fitness',
  'clinical_profile',
  'operational',
  'crew_status',
  'crew_physical',
];
const CREW_VIEWS = ['crew_status', 'crew_physical'];

function assertResource(resource) {
  if (!resource || typeof resource !== 'object') throw new TypeError('resource inválido');
  const { sensitivity, category, action, view = 'detail' } = resource;
  if (!SENSITIVITIES.includes(sensitivity))
    throw new TypeError(`sensitivity inválida: ${sensitivity}`);
  if (!CATEGORIES.includes(category)) throw new TypeError(`category inválida: ${category}`);
  if (!ACTIONS.includes(action)) throw new TypeError(`action inválida: ${action}`);
  if (!VIEWS.includes(view)) throw new TypeError(`view inválida: ${view}`);
}

/** Matriz de permisos. Por defecto, denegar. */
function canAccess(actor, resource) {
  assertResource(resource);
  if (!actor || typeof actor !== 'object') return false;

  const { sensitivity, category, action, view = 'detail' } = resource;
  const confidential = sensitivity === 'confidential';
  const missionIds = Array.isArray(actor.mission_ids) ? actor.mission_ids : [];
  const sameMission = resource.mission_id != null && missionIds.includes(resource.mission_id);
  const habitat = resource.astronaut_id == null; // dato del módulo, no de una persona
  const own =
    !habitat && actor.astronaut_id != null && resource.astronaut_id === actor.astronaut_id;

  // Perfil clínico (sexo biológico): el propio astronauta y el equipo clínico de su misión
  // (flight_surgeon, behavioral_health). admin lo escribe por el panel pero no lo recibe;
  // otro astronauta (CMO y comandante incluidos) nunca lo ve.
  if (view === 'clinical_profile') {
    if (action !== 'read' || habitat) return false;
    if (actor.role === 'astronaut') return own;
    if (actor.role === 'flight_surgeon' || actor.role === 'behavioral_health') return sameMission;
    return false;
  }

  // Pantalla "Tripulación" (GET /crew/status): solo la tripulación vigente de la misión y solo
  // lectura. crew_status = roster, emergencia abierta y alertas físicas escaladas a bordo, sin
  // valores; crew_physical = semáforo físico de cada tripulante (también el propio), solo el
  // oficial médico (CMO). Nunca bienestar ni nada confidencial. El comandante no ve
  // crew_physical: sus permisos delegados son de acceso, no médicos. Tierra y service → no
  // (tienen el panel).
  if (CREW_VIEWS.includes(view)) {
    if (actor.role !== 'astronaut' || action !== 'read' || confidential) return false;
    if (!sameMission || habitat) return false;
    if (view === 'crew_physical') {
      return category === 'physical' && actor.crew_role === 'crew_medical_officer';
    }
    return category === 'physical' || category === 'emergency';
  }

  switch (actor.role) {
    case 'service':
      // Solo escribe lecturas del hábitat de su misión.
      return (
        habitat && sameMission && action === 'write' && category === 'physical' && !confidential
      );

    case 'astronaut': {
      if (own) return true; // todo lo suyo
      if (!sameMission) return false;
      // Hábitat de su misión: ver el estado y registrar una lectura manual.
      if (habitat) return category === 'physical' && !confidential;
      // CMO: físico estándar de la tripulación; confidencial solo si el dueño lo compartió.
      if (actor.crew_role === 'crew_medical_officer' && action === 'read') {
        if (!confidential && category === 'physical') return true;
        if (confidential && resource.share_with_cmo === true) return true;
      }
      // Emergencia activa del triaje: evaluar a otro tripulante y leer sus datos físicos.
      if (resource.emergency_active === true && !confidential) {
        if (category === 'emergency') return true;
        if (category === 'physical' && action === 'read') return true;
      }
      return false; // comandante incluido: nada más de otros astronautas
    }

    case 'behavioral_health':
      // Detalle conductual (confidencial o no) de los astronautas de sus misiones.
      return sameMission && !habitat && category === 'behavioral';

    case 'flight_surgeon':
      // Solo LEE: no registra datos por el astronauta; responde con mensajes de escalamiento.
      if (!sameMission || confidential || action !== 'read') return false;
      if (category === 'physical' || category === 'emergency') return true;
      // De bienestar, solo el estado de las alertas escaladas a él y la aptitud de la PVT
      // (fit | not_confirmed): nunca el detalle ni el cumplimiento (eso es de admin).
      return category === 'behavioral' && (view === 'escalated_alert' || view === 'fitness');

    case 'admin':
      // Solo lectura de lo estándar del panel; de bienestar, cumplimiento y aptitud.
      if (action !== 'read' || confidential) return false;
      if (category === 'behavioral') return view === 'compliance' || view === 'fitness';
      // De una emergencia, solo el estado operativo: el detalle clínico es del flight surgeon.
      if (category === 'emergency') return view === 'operational';
      return true;

    default:
      return false;
  }
}

/**
 * Filtro de respuesta del perfil del astronauta: quita `sex` si el actor no puede ver el
 * perfil clínico (canAccess, vista clinical_profile). Devuelve una copia.
 */
function filterAstronautProfile(actor, profile, { astronautId, missionId }) {
  const { sex, ...rest } = profile;
  const visible = canAccess(actor, {
    astronaut_id: astronautId,
    mission_id: missionId,
    sensitivity: 'standard',
    category: 'physical',
    action: 'read',
    view: 'clinical_profile',
  });
  return visible ? { ...rest, sex: sex ?? null } : rest;
}

/** Aptitud que ve admin: solo "fit" o "not_confirmed", nunca los valores PVT. */
function fitnessForAdmin(results) {
  return Array.isArray(results) ? fitnessFromPvt(results) : 'not_confirmed';
}

const resourceLabel = (label, req) =>
  label ||
  (req ? `${req.method} ${req.baseUrl || ''}${req.route ? req.route.path : req.path}` : 'unknown');

/** Registra en confidential_access_log una lectura confidencial permitida. */
async function logConfidentialAccess(actor, astronautId, label, req, db = pool) {
  return confidentialAccess.insert(
    {
      actorUserId: actor.user_id,
      actorUsername: actor.username,
      actorRole: actor.role,
      astronautId,
      resource: resourceLabel(label, req),
      action: 'read',
      ip: req && req.ip ? req.ip : null,
    },
    db,
  );
}

/**
 * Úsala en los servicios: 403 si canAccess niega; si es una lectura confidencial
 * permitida de un astronauta, deja la fila en confidential_access_log.
 */
async function enforceAccess(actor, resource, { req = null, label = null, db = pool } = {}) {
  if (!canAccess(actor, resource)) {
    throw forbidden(null, 'No tienes permiso para ver o modificar estos datos.');
  }
  if (
    resource.sensitivity === 'confidential' &&
    resource.action === 'read' &&
    resource.astronaut_id
  ) {
    await logConfidentialAccess(actor, resource.astronaut_id, label, req, db);
  }
  return true;
}

/** Arma el actor de canAccess a partir del usuario (rol, perfil, rol de tripulación y misiones). */
async function loadActor(userId, db = pool) {
  const user = await users.findById(userId, db);
  if (!user) return null;
  const actor = {
    user_id: user.id,
    username: user.username,
    role: user.role,
    astronaut_id: null,
    crew_role: null,
    mission_ids: [],
  };
  if (user.role === 'astronaut') {
    const crew = await contextModel.crewContext(user.id, db);
    if (crew) {
      actor.astronaut_id = crew.astronaut_id;
      if (crew.mission_id) {
        actor.crew_role = crew.crew_role;
        actor.mission_ids = [crew.mission_id];
      }
    }
  } else if (user.role === 'service') {
    const mission = await contextModel.serviceMission(user.id, db);
    if (mission) actor.mission_ids = [mission.id];
  } else {
    actor.mission_ids = (await contextModel.groundMissions(user.id, db)).map((m) => m.id);
  }
  return actor;
}

module.exports = {
  canAccess,
  filterAstronautProfile,
  fitnessForAdmin,
  logConfidentialAccess,
  enforceAccess,
  loadActor,
};
