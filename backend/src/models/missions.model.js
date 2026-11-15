'use strict';

/**
 * Misiones, entornos, asignaciones de tripulación y cortes de comunicación (panel admin).
 * Las listas se paginan por cursor de clave (keyset): { after } viene del cursor opaco.
 */
const { pool } = require('../config/db');

const MISSION_COLUMNS = `id, code, name, environment_code, status, starts_at, ends_at, created_at,
  updated_at`;
const ENVIRONMENT_COLUMNS = `code, name, type, gravity_g::float8 AS gravity_g, comm_delay_seconds,
  description, updated_at`;
const ASSIGNMENT_COLUMNS = `ca.id, ca.mission_id, ca.astronaut_id, a.call_sign, ca.crew_role,
  ca.assigned_from, ca.assigned_to, ca.created_at, ca.created_at::text AS created_at_cursor`;
const OUTAGE_COLUMNS = `id, mission_id, starts_at, ends_at, reason, created_at,
  starts_at::text AS starts_at_cursor`;

// ---------------------------------------------------------------- misiones

async function findMission(id, db = pool) {
  const { rows } = await db.query(`SELECT ${MISSION_COLUMNS} FROM missions WHERE id = $1`, [id]);
  return rows[0] || null;
}

/** Primera misión activa (la más reciente); si no hay, la más reciente de cualquier estado. */
async function defaultMission(db = pool) {
  const { rows } = await db.query(
    `SELECT ${MISSION_COLUMNS} FROM missions
     ORDER BY (status = 'active') DESC, starts_at DESC, id LIMIT 1`,
  );
  return rows[0] || null;
}

async function listMissions({ status, after, limit }, db = pool) {
  const params = [status || null, limit + 1];
  let cursorSql = '';
  if (after) {
    params.push(after.k, after.id);
    cursorSql = 'AND (code, id) > ($3, $4::uuid)';
  }
  const { rows } = await db.query(
    `SELECT ${MISSION_COLUMNS} FROM missions
     WHERE ($1::mission_status IS NULL OR status = $1::mission_status) ${cursorSql}
     ORDER BY code, id LIMIT $2`,
    params,
  );
  return rows;
}

async function insertMission(m, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO missions (code, name, environment_code, starts_at, ends_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${MISSION_COLUMNS}`,
    [m.code, m.name, m.environment_code, m.starts_at, m.ends_at ?? null, m.created_by],
  );
  return rows[0];
}

/** PATCH parcial: solo las columnas presentes en `fields` (lista blanca en el servicio). */
async function updateRow(table, keyColumn, key, fields, returning, db) {
  const names = Object.keys(fields);
  const sets = names.map((n, i) => `${n} = $${i + 2}`);
  const { rows } = await db.query(
    `UPDATE ${table} SET ${sets.join(', ')} WHERE ${keyColumn} = $1 RETURNING ${returning}`,
    [key, ...names.map((n) => fields[n])],
  );
  return rows[0] || null;
}

const updateMission = (id, fields, db = pool) =>
  updateRow('missions', 'id', id, fields, MISSION_COLUMNS, db);

async function addGroundMember(missionId, userId, db = pool) {
  await db.query(
    'INSERT INTO mission_ground_team (mission_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [missionId, userId],
  );
}

// ---------------------------------------------------------------- entornos

async function findEnvironment(code, db = pool) {
  const { rows } = await db.query(
    `SELECT ${ENVIRONMENT_COLUMNS} FROM environments WHERE code = $1`,
    [code],
  );
  return rows[0] || null;
}

async function listEnvironments({ after, limit }, db = pool) {
  const params = [limit + 1];
  let cursorSql = '';
  if (after) {
    params.push(after.k);
    cursorSql = 'WHERE code > $2';
  }
  const { rows } = await db.query(
    `SELECT ${ENVIRONMENT_COLUMNS} FROM environments ${cursorSql} ORDER BY code LIMIT $1`,
    params,
  );
  return rows;
}

async function insertEnvironment(e, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO environments (code, name, type, gravity_g, comm_delay_seconds, description)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${ENVIRONMENT_COLUMNS}`,
    [e.code, e.name, e.type, e.gravity_g, e.comm_delay_seconds, e.description ?? null],
  );
  return rows[0];
}

const updateEnvironment = (code, fields, db = pool) =>
  updateRow('environments', 'code', code, fields, ENVIRONMENT_COLUMNS, db);

// ---------------------------------------------------------------- asignaciones

async function findAssignment(id, db = pool) {
  const { rows } = await db.query(
    `SELECT ${ASSIGNMENT_COLUMNS} FROM crew_assignments ca
     JOIN astronauts a ON a.id = ca.astronaut_id WHERE ca.id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** active = vigente como v_current_crew: assigned_from <= now() < assigned_to. */
async function listAssignments({ missionId, active, after, limit }, db = pool) {
  const params = [missionId, active === undefined ? null : active, limit + 1];
  let cursorSql = '';
  if (after) {
    params.push(after.c, after.id);
    cursorSql = 'AND (ca.created_at, ca.id) > ($4::timestamptz, $5::uuid)';
  }
  const { rows } = await db.query(
    `SELECT ${ASSIGNMENT_COLUMNS} FROM crew_assignments ca
     JOIN astronauts a ON a.id = ca.astronaut_id
     WHERE ca.mission_id = $1
       AND ($2::boolean IS NULL OR $2::boolean = (
             ca.assigned_from <= now() AND (ca.assigned_to IS NULL OR ca.assigned_to > now())))
       ${cursorSql}
     ORDER BY ca.created_at, ca.id LIMIT $3`,
    params,
  );
  return rows;
}

async function insertAssignment(a, db = pool) {
  const { rows } = await db.query(
    `WITH ca AS (
       INSERT INTO crew_assignments (mission_id, astronaut_id, crew_role, assigned_from, created_by)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()), $5)
       RETURNING *)
     SELECT ${ASSIGNMENT_COLUMNS} FROM ca JOIN astronauts a ON a.id = ca.astronaut_id`,
    [a.mission_id, a.astronaut_id, a.crew_role, a.assigned_from ?? null, a.created_by],
  );
  return rows[0];
}

async function updateAssignment(id, fields, db = pool) {
  const row = await updateRow('crew_assignments', 'id', id, fields, 'id', db);
  return row ? findAssignment(id, db) : null;
}

/**
 * Asignación que choca con un periodo: del mismo astronauta o, si se indica crewRole
 * (commander|crew_medical_officer), del mismo rol en la misión.
 */
async function findOverlappingAssignment(
  { excludeId = null, astronautId, missionId, crewRole = null, from, to },
  db = pool,
) {
  const { rows } = await db.query(
    `SELECT id FROM crew_assignments
     WHERE ($1::uuid IS NULL OR id <> $1)
       AND (CASE WHEN $4::crew_role IS NULL THEN astronaut_id = $2
                 ELSE mission_id = $3 AND crew_role = $4::crew_role END)
       AND tstzrange(assigned_from, COALESCE(assigned_to, 'infinity'::timestamptz), '[)')
           && tstzrange($5::timestamptz, COALESCE($6::timestamptz, 'infinity'::timestamptz), '[)')
     LIMIT 1`,
    [excludeId, astronautId, missionId, crewRole, from, to ?? null],
  );
  return rows[0] ? rows[0].id : null;
}

async function astronautExists(id, db = pool) {
  const { rows } = await db.query('SELECT 1 FROM astronauts WHERE id = $1', [id]);
  return rows.length > 0;
}

// ---------------------------------------------------------------- cortes de comunicación

async function findOutage(id, db = pool) {
  const { rows } = await db.query(
    `SELECT ${OUTAGE_COLUMNS} FROM mission_comm_outages WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function listOutages({ missionId, after, limit }, db = pool) {
  const params = [missionId, limit + 1];
  let cursorSql = '';
  if (after) {
    params.push(after.s, after.id);
    cursorSql = 'AND (starts_at, id) < ($3::timestamptz, $4::uuid)';
  }
  const { rows } = await db.query(
    `SELECT ${OUTAGE_COLUMNS} FROM mission_comm_outages
     WHERE mission_id = $1 ${cursorSql}
     ORDER BY starts_at DESC, id DESC LIMIT $2`,
    params,
  );
  return rows;
}

async function insertOutage(o, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO mission_comm_outages (mission_id, starts_at, ends_at, reason)
     VALUES ($1, $2, $3, $4)
     RETURNING ${OUTAGE_COLUMNS}`,
    [o.mission_id, o.starts_at, o.ends_at ?? null, o.reason],
  );
  return rows[0];
}

const updateOutage = (id, fields, db = pool) =>
  updateRow('mission_comm_outages', 'id', id, fields, OUTAGE_COLUMNS, db);

async function findOverlappingOutage({ excludeId = null, missionId, from, to }, db = pool) {
  const { rows } = await db.query(
    `SELECT id FROM mission_comm_outages
     WHERE mission_id = $2 AND ($1::uuid IS NULL OR id <> $1)
       AND tstzrange(starts_at, COALESCE(ends_at, 'infinity'::timestamptz), '[)')
           && tstzrange($3::timestamptz, COALESCE($4::timestamptz, 'infinity'::timestamptz), '[)')
     LIMIT 1`,
    [excludeId, missionId, from, to ?? null],
  );
  return rows[0] ? rows[0].id : null;
}

/** Cortes vigentes o futuros de la misión (current = ya empezó), en orden de inicio. */
async function activeAndUpcomingOutages(missionId, db = pool) {
  const { rows } = await db.query(
    `SELECT ${OUTAGE_COLUMNS}, (starts_at <= now()) AS current FROM mission_comm_outages
     WHERE mission_id = $1 AND (ends_at IS NULL OR ends_at > now())
     ORDER BY starts_at, id LIMIT 20`,
    [missionId],
  );
  return rows;
}

module.exports = {
  activeAndUpcomingOutages,
  findMission,
  defaultMission,
  listMissions,
  insertMission,
  updateMission,
  addGroundMember,
  findEnvironment,
  listEnvironments,
  insertEnvironment,
  updateEnvironment,
  findAssignment,
  listAssignments,
  insertAssignment,
  updateAssignment,
  findOverlappingAssignment,
  astronautExists,
  findOutage,
  listOutages,
  insertOutage,
  updateOutage,
  findOverlappingOutage,
};
