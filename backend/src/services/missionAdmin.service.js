'use strict';

/**
 * Administración de la misión (rol admin): misiones, entornos, asignaciones de tripulación y
 * cortes de comunicación. Contrato: tag Misión de docs/openapi.yaml.
 * Al crear, corregir o cerrar un corte se recalcula deliver_at de lo que esperaba enlace.
 */
const { HttpError, badRequest, notFound, conflict, forbidden } = require('../utils/httpError');
const { validate, uuidParam, isUuid } = require('../utils/validate');
const {
  decodeCursor,
  limitIssue,
  parseLimit,
  toPage,
  isTimestampText,
} = require('../utils/pagination');
const { withTransaction } = require('../models/transaction');
const missions = require('../models/missions.model');
const { loadActor } = require('./accessPolicy');
const { resolveMission } = require('./missionScope');
const delivery = require('./escalationDelivery.service');

const MISSION_STATUSES = ['planned', 'active', 'completed', 'aborted'];
const ENVIRONMENT_TYPES = ['spacecraft', 'space_station', 'rover', 'lunar_base', 'mars_base'];
const CREW_ROLES = [
  'commander',
  'pilot',
  'crew_medical_officer',
  'flight_engineer',
  'mission_specialist',
];
const UNIQUE_CREW_ROLES = ['commander', 'crew_medical_officer'];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

// ---------------------------------------------------------------- validación

const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);

function timestamp(v, field, { required = true, nullable = false } = {}) {
  const value = v.get(field);
  if (value === undefined || (value === null && nullable)) {
    if (required && value === undefined) v.add(field, 'es obligatorio');
    return;
  }
  if (typeof value !== 'string' || !ISO_RE.test(value) || Number.isNaN(Date.parse(value))) {
    v.add(field, 'debe ser una fecha ISO 8601 en UTC');
  }
}

function number(v, field, { required = true, integer = false, min, max } = {}) {
  const value = v.get(field);
  if (value === undefined || value === null) {
    if (required) v.add(field, 'es obligatorio');
    return;
  }
  const ok =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (!integer || Number.isInteger(value)) &&
    (min === undefined || value >= min) &&
    (max === undefined || value <= max);
  if (!ok) {
    const kind = integer ? 'un entero' : 'un número';
    const range = max === undefined ? `>= ${min}` : `entre ${min} y ${max}`;
    v.add(field, `debe ser ${kind} ${range}`);
  }
}

/** PATCH: solo campos conocidos y al menos uno (minProperties: 1). */
function patchFields(body, allowed) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const fields = Object.fromEntries(
    allowed.filter((k) => has(source, k)).map((k) => [k, source[k]]),
  );
  if (!Object.keys(fields).length) {
    throw badRequest([{ field: 'body', issue: `indica al menos uno de: ${allowed.join(', ')}` }]);
  }
  return fields;
}

const endsAfterStart = (starts, ends) =>
  ends === null || ends === undefined || Date.parse(ends) > Date.parse(starts);

function listQuery(query, extra = []) {
  const problems = [...extra];
  const limitProblem = limitIssue(query.limit);
  if (limitProblem) problems.push({ field: 'limit', issue: limitProblem });
  if (problems.length) throw badRequest(problems);
  return parseLimit(query.limit);
}

/** Restricciones de la BD que no se validaron antes (carreras) → errores del contrato. */
function mapDbError(err, messages = {}) {
  if (err.code === '23505') return conflict('CONFLICT', messages.unique || 'Ya existe.', null);
  if (err.code === '23514') {
    return badRequest([{ field: messages.checkField || 'body', issue: 'fechas incompatibles' }]);
  }
  if (err.code === '23503') return badRequest([{ field: 'body', issue: 'referencia inexistente' }]);
  return err;
}

async function adminActor(userId) {
  return loadActor(userId);
}

// ---------------------------------------------------------------- misiones

const toMission = (m) => ({
  id: m.id,
  code: m.code,
  name: m.name,
  environment_code: m.environment_code,
  status: m.status,
  starts_at: m.starts_at,
  ends_at: m.ends_at,
  created_at: m.created_at,
  updated_at: m.updated_at,
});

async function listMissions({ query }) {
  const extra = [];
  if (query.status !== undefined && !MISSION_STATUSES.includes(query.status)) {
    extra.push({ field: 'status', issue: `debe ser uno de: ${MISSION_STATUSES.join(', ')}` });
  }
  const limit = listQuery(query, extra);
  const after = decodeCursor(query.cursor, (c) => typeof c.k === 'string' && isUuid(c.id));
  const rows = await missions.listMissions({ status: query.status, after, limit });
  return toPage(rows, limit, (r) => ({ k: r.code, id: r.id }), toMission);
}

async function assertEnvironment(code, problems) {
  if (typeof code === 'string' && !(await missions.findEnvironment(code))) {
    problems.push({ field: 'environment_code', issue: 'el entorno no existe' });
  }
}

/** Crea la misión y agrega al admin que la crea a su equipo en Tierra (operations). */
async function createMission({ userId, body }) {
  const v = validate(body)
    .string('code', { min: 2, max: 20 })
    .string('name', { max: 120 })
    .string('environment_code', { max: 40 });
  timestamp(v, 'starts_at');
  timestamp(v, 'ends_at', { required: false, nullable: true });
  const input = v.body;
  if (!v.problems.length && !endsAfterStart(input.starts_at, input.ends_at)) {
    v.add('ends_at', 'debe ser posterior a starts_at');
  }
  await assertEnvironment(input.environment_code, v.problems);
  v.check();

  try {
    return await withTransaction(async (db) => {
      const mission = await missions.insertMission({ ...input, created_by: userId }, db);
      await missions.addGroundMember(mission.id, userId, db);
      return toMission(mission);
    });
  } catch (err) {
    if (err.code === '23505') {
      throw conflict('CONFLICT', `La misión ${input.code} ya existe.`, { field: 'code' });
    }
    throw mapDbError(err);
  }
}

async function updateMission({ id, body }) {
  const missionId = uuidParam(id);
  const fields = patchFields(body, ['name', 'environment_code', 'status', 'ends_at']);
  const v = validate(fields)
    .string('name', { required: false, max: 120 })
    .string('environment_code', { required: false, max: 40 })
    .oneOf('status', MISSION_STATUSES, { required: false });
  timestamp(v, 'ends_at', { required: false, nullable: true });
  for (const key of ['name', 'environment_code', 'status']) {
    if (has(fields, key) && fields[key] === null) v.add(key, 'no puede ser null');
  }
  if (has(fields, 'environment_code')) await assertEnvironment(fields.environment_code, v.problems);
  v.check();

  const current = await missions.findMission(missionId);
  if (!current) throw notFound('La misión no existe.');
  if (has(fields, 'ends_at') && !endsAfterStart(current.starts_at, fields.ends_at)) {
    throw badRequest([{ field: 'ends_at', issue: 'debe ser posterior a starts_at' }]);
  }
  try {
    return toMission(await missions.updateMission(missionId, fields));
  } catch (err) {
    throw mapDbError(err, { checkField: 'ends_at' });
  }
}

// ---------------------------------------------------------------- entornos

const toEnvironment = (e) => ({
  code: e.code,
  name: e.name,
  type: e.type,
  gravity_g: e.gravity_g,
  comm_delay_seconds: e.comm_delay_seconds,
  description: e.description,
  updated_at: e.updated_at,
});

async function listEnvironments({ query }) {
  const limit = listQuery(query);
  const after = decodeCursor(query.cursor, (c) => typeof c.k === 'string');
  const rows = await missions.listEnvironments({ after, limit });
  return toPage(rows, limit, (r) => ({ k: r.code }), toEnvironment);
}

function validateEnvironment(v, { required }) {
  number(v, 'gravity_g', { required, min: 0, max: 1.5 });
  number(v, 'comm_delay_seconds', { required, integer: true, min: 0, max: 86400 });
  const description = v.get('description');
  if (description !== undefined && description !== null) {
    v.string('description', { max: 500 });
  }
}

async function createEnvironment({ body }) {
  const v = validate(body)
    .string('code', {
      max: 40,
      pattern: /^[a-z0-9_]+$/,
      patternIssue: 'solo minúsculas, números y guion bajo',
    })
    .string('name', { max: 80 })
    .oneOf('type', ENVIRONMENT_TYPES);
  validateEnvironment(v, { required: true });
  const input = v.check();
  try {
    return toEnvironment(await missions.insertEnvironment(input));
  } catch (err) {
    if (err.code === '23505') {
      throw conflict('CONFLICT', `El entorno ${input.code} ya existe.`, { field: 'code' });
    }
    throw mapDbError(err);
  }
}

/**
 * Actualiza un entorno. Un retraso nuevo solo afecta a lo que se envíe desde ahora: lo que ya
 * está en camino conserva su deliver_at.
 */
async function updateEnvironment({ code, body }) {
  if (typeof code !== 'string' || !/^[a-z0-9_]+$/.test(code)) {
    throw badRequest([{ field: 'code', issue: 'formato inválido' }]);
  }
  const fields = patchFields(body, ['name', 'gravity_g', 'comm_delay_seconds', 'description']);
  const v = validate(fields).string('name', { required: false, max: 80 });
  if (has(fields, 'name') && fields.name === null) v.add('name', 'no puede ser null');
  validateEnvironment(v, { required: false });
  for (const key of ['gravity_g', 'comm_delay_seconds']) {
    if (has(fields, key) && fields[key] === null) v.add(key, 'no puede ser null');
  }
  v.check();
  const updated = await missions.updateEnvironment(code, fields);
  if (!updated) throw notFound('El entorno no existe.');
  return toEnvironment(updated);
}

// ---------------------------------------------------------------- asignaciones

const toAssignment = (a) => ({
  id: a.id,
  mission_id: a.mission_id,
  astronaut_id: a.astronaut_id,
  call_sign: a.call_sign,
  crew_role: a.crew_role,
  assigned_from: a.assigned_from,
  assigned_to: a.assigned_to,
  created_at: a.created_at,
});

async function listAssignments({ userId, query }) {
  const extra = [];
  if (query.active !== undefined && !['true', 'false'].includes(query.active)) {
    extra.push({ field: 'active', issue: 'debe ser true o false' });
  }
  const limit = listQuery(query, extra);
  const after = decodeCursor(query.cursor, (c) => isTimestampText(c.c) && isUuid(c.id));
  const mission = await resolveMission(await adminActor(userId), query.mission_id);
  const rows = await missions.listAssignments({
    missionId: mission.id,
    active: query.active === undefined ? undefined : query.active === 'true',
    after,
    limit,
  });
  return toPage(rows, limit, (r) => ({ c: r.created_at_cursor, id: r.id }), toAssignment);
}

/** 409 del contrato si el periodo choca con otra asignación (astronauta o rol único). */
async function assertNoAssignmentOverlap(
  { excludeId, astronautId, missionId, crewRole, from, to },
  db,
) {
  const sameAstronaut = await missions.findOverlappingAssignment(
    { excludeId, astronautId, missionId, from, to },
    db,
  );
  if (sameAstronaut) {
    throw conflict('ASSIGNMENT_OVERLAP', 'El astronauta ya tiene una asignación en ese periodo.', {
      conflicting_assignment_id: sameAstronaut,
    });
  }
  if (UNIQUE_CREW_ROLES.includes(crewRole)) {
    const sameRole = await missions.findOverlappingAssignment(
      { excludeId, astronautId, missionId, crewRole, from, to },
      db,
    );
    if (sameRole) {
      throw conflict(
        'CREW_ROLE_TAKEN',
        'La misión ya tiene ese rol de tripulación en ese periodo.',
        {
          crew_role: crewRole,
          conflicting_assignment_id: sameRole,
        },
      );
    }
  }
}

function mapAssignmentError(err, crewRole) {
  switch (err.constraint) {
    case 'crew_assignments_no_overlap':
      return conflict(
        'ASSIGNMENT_OVERLAP',
        'El astronauta ya tiene una asignación en ese periodo.',
      );
    case 'crew_one_commander_ex':
    case 'crew_one_cmo_ex':
      return conflict(
        'CREW_ROLE_TAKEN',
        'La misión ya tiene ese rol de tripulación en ese periodo.',
        {
          crew_role: crewRole,
        },
      );
    case 'crew_assignments_dates_ck':
      return badRequest([{ field: 'assigned_to', issue: 'debe ser posterior a assigned_from' }]);
    default:
      return mapDbError(err);
  }
}

async function createAssignment({ userId, body }) {
  const v = validate(body).uuid('mission_id').uuid('astronaut_id').oneOf('crew_role', CREW_ROLES);
  timestamp(v, 'assigned_from', { required: false });
  const input = v.check();
  const problems = [];
  if (!(await missions.findMission(input.mission_id))) {
    problems.push({ field: 'mission_id', issue: 'la misión no existe' });
  }
  if (!(await missions.astronautExists(input.astronaut_id))) {
    problems.push({ field: 'astronaut_id', issue: 'el astronauta no existe' });
  }
  if (problems.length) throw badRequest(problems);

  try {
    return await withTransaction(async (db) => {
      await assertNoAssignmentOverlap(
        {
          excludeId: null,
          astronautId: input.astronaut_id,
          missionId: input.mission_id,
          crewRole: input.crew_role,
          from: input.assigned_from || new Date().toISOString(),
          to: null,
        },
        db,
      );
      return toAssignment(await missions.insertAssignment({ ...input, created_by: userId }, db));
    });
  } catch (err) {
    throw err.status ? err : mapAssignmentError(err, input.crew_role);
  }
}

async function updateAssignment({ id, body }) {
  const assignmentId = uuidParam(id);
  const fields = patchFields(body, ['assigned_to', 'crew_role']);
  const v = validate(fields).oneOf('crew_role', CREW_ROLES, { required: false });
  timestamp(v, 'assigned_to', { required: false });
  if (has(fields, 'assigned_to') && fields.assigned_to === null) {
    v.add('assigned_to', 'no puede ser null');
  }
  if (has(fields, 'crew_role') && fields.crew_role === null)
    v.add('crew_role', 'no puede ser null');
  v.check();

  try {
    return await withTransaction(async (db) => {
      const current = await missions.findAssignment(assignmentId, db);
      if (!current) throw notFound('La asignación no existe.');
      const next = { ...current, ...fields };
      if (next.assigned_to && new Date(next.assigned_to) <= new Date(next.assigned_from)) {
        throw badRequest([{ field: 'assigned_to', issue: 'debe ser posterior a assigned_from' }]);
      }
      await assertNoAssignmentOverlap(
        {
          excludeId: assignmentId,
          astronautId: current.astronaut_id,
          missionId: current.mission_id,
          crewRole: next.crew_role,
          from: new Date(next.assigned_from).toISOString(),
          to: next.assigned_to ? new Date(next.assigned_to).toISOString() : null,
        },
        db,
      );
      return toAssignment(await missions.updateAssignment(assignmentId, fields, db));
    });
  } catch (err) {
    throw err.status ? err : mapAssignmentError(err, fields.crew_role);
  }
}

// ---------------------------------------------------------------- cortes de comunicación

const toOutage = (o) => ({
  id: o.id,
  mission_id: o.mission_id,
  starts_at: o.starts_at,
  ends_at: o.ends_at,
  reason: o.reason,
  created_at: o.created_at,
});

async function listOutages({ userId, query }) {
  const limit = listQuery(query);
  const after = decodeCursor(query.cursor, (c) => isTimestampText(c.s) && isUuid(c.id));
  const mission = await resolveMission(await adminActor(userId), query.mission_id);
  const rows = await missions.listOutages({ missionId: mission.id, after, limit });
  return toPage(rows, limit, (r) => ({ s: r.starts_at_cursor, id: r.id }), toOutage);
}

async function assertNoOutageOverlap({ excludeId, missionId, from, to }, db) {
  const other = await missions.findOverlappingOutage({ excludeId, missionId, from, to }, db);
  if (other) {
    throw conflict('OUTAGE_OVERLAP', 'Ya hay un corte de comunicación en ese periodo.', {
      conflicting_outage_id: other,
    });
  }
}

function mapOutageError(err) {
  if (err.constraint === 'outage_no_overlap') {
    return conflict('OUTAGE_OVERLAP', 'Ya hay un corte de comunicación en ese periodo.');
  }
  if (err.constraint === 'outage_dates_ck') {
    return badRequest([{ field: 'ends_at', issue: 'debe ser posterior a starts_at' }]);
  }
  return mapDbError(err);
}

/** Crea el corte y recalcula deliver_at de lo pendiente de la misión. */
async function createOutage({ body }) {
  const v = validate(body).uuid('mission_id').string('reason', { max: 200 });
  timestamp(v, 'starts_at');
  timestamp(v, 'ends_at', { required: false, nullable: true });
  const input = v.body;
  if (!v.problems.length && !endsAfterStart(input.starts_at, input.ends_at)) {
    v.add('ends_at', 'debe ser posterior a starts_at');
  }
  v.check();
  if (!(await missions.findMission(input.mission_id))) {
    throw badRequest([{ field: 'mission_id', issue: 'la misión no existe' }]);
  }
  try {
    return await withTransaction(async (db) => {
      await assertNoOutageOverlap(
        { excludeId: null, missionId: input.mission_id, from: input.starts_at, to: input.ends_at },
        db,
      );
      const outage = await missions.insertOutage(input, db);
      await delivery.recomputeAfterOutageChange(outage.mission_id, db);
      return toOutage(outage);
    });
  } catch (err) {
    throw err.status ? err : mapOutageError(err);
  }
}

/**
 * Cierra (ends_at), reabre (ends_at: null) o corrige un corte. Siempre recalcula lo pendiente:
 * al cerrar, lo que estaba en cola (deliver_at NULL) sale cuando vuelve el enlace + retraso.
 */
async function updateOutage({ id, body }) {
  const outageId = uuidParam(id);
  const fields = patchFields(body, ['ends_at', 'reason']);
  const v = validate(fields).string('reason', { required: false, max: 200 });
  if (has(fields, 'reason') && fields.reason === null) v.add('reason', 'no puede ser null');
  timestamp(v, 'ends_at', { required: false, nullable: true });
  v.check();
  try {
    return await withTransaction(async (db) => {
      const current = await missions.findOutage(outageId, db);
      if (!current) throw notFound('El corte no existe.');
      if (has(fields, 'ends_at')) {
        if (!endsAfterStart(current.starts_at, fields.ends_at)) {
          throw badRequest([{ field: 'ends_at', issue: 'debe ser posterior a starts_at' }]);
        }
        await assertNoOutageOverlap(
          {
            excludeId: outageId,
            missionId: current.mission_id,
            from: new Date(current.starts_at).toISOString(),
            to: fields.ends_at,
          },
          db,
        );
      }
      const outage = await missions.updateOutage(outageId, fields, db);
      await delivery.recomputeAfterOutageChange(outage.mission_id, db);
      return toOutage(outage);
    });
  } catch (err) {
    throw err.status ? err : mapOutageError(err);
  }
}

// ---------------------------------------------------------------- misión vigente

/**
 * GET /missions/current: para un astronauta, la de su asignación vigente (mission_id se
 * ignora); para Tierra, la de mission_id o la activa más reciente de su equipo (admin es
 * global). Con el entorno, el rol de tripulación y el estado del enlace (cortes).
 */
async function currentMission({ userId, query }) {
  const actor = await loadActor(userId);
  if (!actor) throw forbidden();
  let mission;
  if (actor.role === 'astronaut') {
    if (!actor.mission_ids.length) {
      throw new HttpError(
        403,
        'NO_ACTIVE_ASSIGNMENT',
        'No tienes una asignación de misión vigente.',
      );
    }
    mission = await missions.findMission(actor.mission_ids[0]);
  } else {
    mission = await resolveMission(actor, query.mission_id);
    if (actor.role !== 'admin' && !actor.mission_ids.includes(mission.id)) {
      throw forbidden(null, 'No eres parte del equipo de esta misión.');
    }
  }
  const [environment, outages] = await Promise.all([
    missions.findEnvironment(mission.environment_code),
    missions.activeAndUpcomingOutages(mission.id),
  ]);
  const current = outages.find((o) => o.current);
  return {
    mission: toMission(mission),
    environment: toEnvironment(environment),
    crew_role: actor.role === 'astronaut' ? actor.crew_role : null,
    comm: {
      delay_seconds: environment.comm_delay_seconds,
      link: current ? 'down' : 'up',
      ...(current ? { current_outage: toOutage(current) } : {}),
      upcoming_outages: outages.filter((o) => !o.current).map(toOutage),
    },
  };
}

module.exports = {
  currentMission,
  listMissions,
  createMission,
  updateMission,
  listEnvironments,
  createEnvironment,
  updateEnvironment,
  listAssignments,
  createAssignment,
  updateAssignment,
  listOutages,
  createOutage,
  updateOutage,
};
