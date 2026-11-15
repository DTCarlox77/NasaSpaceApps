'use strict';

/**
 * Bienestar (CONFIDENCIAL): check-ins, corridas PVT y cuestionarios, con sus lecturas
 * agrupadas. Solo escritura y consultas internas del registro: lo que se muestra pasa por
 * accessPolicy en los servicios (y el panel nunca lee estas tablas).
 */
const { pool } = require('../config/db');

/** Inserta el grupo si no existe (idempotente por astronauta + client_uuid). */
async function insertGroup(table, columns, values, db) {
  const names = ['client_uuid', 'astronaut_id', ...columns];
  const params = names.map((_, i) => `$${i + 1}`);
  const { rows } = await db.query(
    `INSERT INTO ${table} (${names.join(', ')}) VALUES (${params.join(', ')})
     ON CONFLICT (astronaut_id, client_uuid) DO NOTHING
     RETURNING id, received_at`,
    values,
  );
  if (rows[0]) return { id: rows[0].id, received_at: rows[0].received_at, created: true };
  const existing = await db.query(
    `SELECT id, received_at FROM ${table} WHERE astronaut_id = $2 AND client_uuid = $1`,
    values.slice(0, 2),
  );
  return { id: existing.rows[0].id, received_at: existing.rows[0].received_at, created: false };
}

const insertCheckin = (
  { clientUuid, astronautId, measuredAt, sleepHours, privateNote, supersedesId = null },
  db = pool,
) =>
  insertGroup(
    'wellbeing_checkins',
    ['measured_at', 'sleep_hours', 'private_note', 'supersedes_id'],
    [clientUuid, astronautId, measuredAt, sleepHours ?? null, privateNote ?? null, supersedesId],
    db,
  );

/** Check-in del astronauta por su client_uuid (sin la nota privada). */
async function findCheckin(astronautId, clientUuid, db = pool) {
  const { rows } = await db.query(
    `SELECT id, client_uuid, measured_at, received_at, supersedes_id
     FROM wellbeing_checkins WHERE astronaut_id = $1 AND client_uuid = $2`,
    [astronautId, clientUuid],
  );
  return rows[0] || null;
}

/**
 * Check-in vigente (que ningún otro corrige) del astronauta en [from, to), con las lecturas
 * vigentes de su grupo: readings = { WB_MOOD: client_uuid, ..., SLEEP_HOURS?: client_uuid }.
 * Si hubiera más de uno (datos de antes de la regla), el último recibido.
 */
async function currentCheckinOfDay({ astronautId, from, to }, db = pool) {
  const { rows } = await db.query(
    `SELECT c.id FROM wellbeing_checkins c
     WHERE c.astronaut_id = $1 AND c.measured_at >= $2 AND c.measured_at < $3
       AND NOT EXISTS (SELECT 1 FROM wellbeing_checkins n WHERE n.supersedes_id = c.id)
     ORDER BY c.received_at DESC, c.measured_at DESC, c.id DESC
     LIMIT 1`,
    [astronautId, from, to],
  );
  if (!rows[0]) return null;
  const { rows: current } = await db.query(
    `SELECT r.indicator_code, r.client_uuid FROM readings r
     WHERE r.wellbeing_checkin_id = $1
       AND NOT EXISTS (SELECT 1 FROM readings s
                       WHERE s.recorded_by = r.recorded_by AND s.supersedes_uuid = r.client_uuid)`,
    [rows[0].id],
  );
  return {
    id: rows[0].id,
    readings: Object.fromEntries(current.map((r) => [r.indicator_code, r.client_uuid])),
  };
}

/**
 * Evaluaciones de las lecturas vigentes de un grupo (para responder un duplicado con el mismo
 * mensaje neutro). column: wellbeing_checkin_id | pvt_run_id | instrument_administration_id.
 */
async function groupEvaluations(column, groupId, db = pool) {
  const allowed = ['wellbeing_checkin_id', 'pvt_run_id', 'instrument_administration_id'];
  if (!allowed.includes(column)) throw new Error(`columna inválida: ${column}`);
  const { rows } = await db.query(
    `SELECT r.indicator_code, e.level, e.escalation::text AS escalation, e.recommendation
     FROM readings r JOIN reading_evaluations e ON e.reading_id = r.id
     WHERE r.${column} = $1
       AND NOT EXISTS (SELECT 1 FROM readings s
                       WHERE s.recorded_by = r.recorded_by AND s.supersedes_uuid = r.client_uuid)`,
    [groupId],
  );
  return rows;
}

/**
 * Días UTC (YYYY-MM-DD, del más reciente al más antiguo) con al menos un check-in del
 * astronauta desde `since`. Solo cuenta que se hizo: nunca el resultado.
 */
async function checkinDays(astronautIds, since, db = pool) {
  const { rows } = await db.query(
    `SELECT astronaut_id,
            array_agg(DISTINCT to_char(measured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')) AS days,
            max(measured_at) AS last_checkin_at
     FROM wellbeing_checkins
     WHERE astronaut_id = ANY($1::uuid[]) AND measured_at >= $2
     GROUP BY astronaut_id`,
    [astronautIds, since],
  );
  return new Map(
    rows.map((r) => [
      r.astronaut_id,
      { days: [...r.days].sort().reverse(), last_checkin_at: r.last_checkin_at },
    ]),
  );
}

/** Último check-in de cada astronauta (solo la hora). */
async function lastCheckinAt(astronautIds, db = pool) {
  const { rows } = await db.query(
    `SELECT astronaut_id, max(measured_at) AS last_checkin_at
     FROM wellbeing_checkins WHERE astronaut_id = ANY($1::uuid[]) GROUP BY astronaut_id`,
    [astronautIds],
  );
  return new Map(rows.map((r) => [r.astronaut_id, r.last_checkin_at]));
}

/**
 * Aptitud para tarea crítica (fit | not_confirmed) de la PVT más reciente de cada astronauta
 * medida desde `since`. Sin PVT reciente, el astronauta no aparece (= not_confirmed).
 */
async function recentFitness(astronautIds, since, db = pool) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (astronaut_id) astronaut_id, fitness, measured_at
     FROM pvt_runs WHERE astronaut_id = ANY($1::uuid[]) AND measured_at >= $2
     ORDER BY astronaut_id, measured_at DESC, received_at DESC`,
    [astronautIds, since],
  );
  return new Map(rows.map((r) => [r.astronaut_id, r.fitness]));
}

/** Conteos de cumplimiento en [from, to): cuestionarios y corridas PVT (sin contenido). */
async function complianceCounts(astronautIds, from, to, db = pool) {
  const { rows } = await db.query(
    `SELECT a.id AS astronaut_id,
            (SELECT count(*) FROM instrument_administrations i
             WHERE i.astronaut_id = a.id AND i.measured_at >= $2 AND i.measured_at < $3)::int
              AS screenings,
            (SELECT count(*) FROM pvt_runs p
             WHERE p.astronaut_id = a.id AND p.measured_at >= $2 AND p.measured_at < $3)::int
              AS pvt_runs
     FROM astronauts a WHERE a.id = ANY($1::uuid[])`,
    [astronautIds, from, to],
  );
  return new Map(rows.map((r) => [r.astronaut_id, r]));
}

/** Último cuestionario de cada instrumento del astronauta (para screening_due). */
async function lastScreenings(astronautId, db = pool) {
  const { rows } = await db.query(
    `SELECT i.code, max(a.measured_at) AS last_at
     FROM instrument_administrations a JOIN instruments i ON i.id = a.instrument_id
     WHERE a.astronaut_id = $1 GROUP BY i.code`,
    [astronautId],
  );
  return new Map(rows.map((r) => [r.code, r.last_at]));
}

/** Grupo PVT o cuestionario del astronauta por client_uuid (para responder duplicados). */
async function findGroup(table, astronautId, clientUuid, db = pool) {
  const allowed = ['pvt_runs', 'instrument_administrations', 'wellbeing_checkins'];
  if (!allowed.includes(table)) throw new Error(`tabla inválida: ${table}`);
  const { rows } = await db.query(
    `SELECT id, received_at FROM ${table} WHERE astronaut_id = $1 AND client_uuid = $2`,
    [astronautId, clientUuid],
  );
  return rows[0] || null;
}

/** La aptitud se fija después de evaluar las lecturas (setPvtFitness). */
const insertPvtRun = (
  { clientUuid, astronautId, deviceId, beforeCriticalTask, durationS, trials, measuredAt },
  db = pool,
) =>
  insertGroup(
    'pvt_runs',
    ['device_id', 'before_critical_task', 'duration_s', 'trials', 'fitness', 'measured_at'],
    [
      clientUuid,
      astronautId,
      deviceId,
      Boolean(beforeCriticalTask),
      durationS ?? null,
      trials ?? null,
      'not_confirmed',
      measuredAt,
    ],
    db,
  );

async function setPvtFitness(id, fitness, db = pool) {
  await db.query('UPDATE pvt_runs SET fitness = $2 WHERE id = $1', [id, fitness]);
}

async function pvtFitness(id, db = pool) {
  const { rows } = await db.query('SELECT fitness FROM pvt_runs WHERE id = $1', [id]);
  return rows[0] ? rows[0].fitness : null;
}

const insertAdministration = (
  { clientUuid, astronautId, instrumentId, answers, score, measuredAt },
  db = pool,
) =>
  insertGroup(
    'instrument_administrations',
    ['instrument_id', 'answers', 'score', 'measured_at'],
    [clientUuid, astronautId, instrumentId, answers, score, measuredAt],
    db,
  );

/** Versión activa de un cuestionario (PHQ2, GAD2). */
async function activeInstrument(code, db = pool) {
  const { rows } = await db.query(
    'SELECT id, code, version, indicator_code FROM instruments WHERE code = $1 AND is_active',
    [code],
  );
  return rows[0] || null;
}

/** Cuestionarios activos (PHQ-2, GAD-2) con su definición, fuentes y licencia. */
async function activeInstruments(db = pool) {
  const { rows } = await db.query(
    `SELECT code, version, name, indicator_code, definition, sources, license
     FROM instruments WHERE is_active ORDER BY code`,
  );
  return rows;
}

const TS_TEXT = (expr) => `to_char(${expr} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const CURRENT_READING = `NOT EXISTS (SELECT 1 FROM readings s
  WHERE s.recorded_by = r.recorded_by AND s.supersedes_uuid = r.client_uuid)`;

/**
 * Historial propio (GET /me/wellbeing), del más reciente al más antiguo (keyset at, id):
 * check-ins vigentes (valores y nota privada: son suyos), cuestionarios (solo el
 * instrumento), corridas PVT (solo la aptitud) y solicitudes de apoyo (estado). Nunca niveles
 * ni puntajes.
 */
async function historyPage({ astronautId, from, to, after, limit }, db = pool) {
  const params = [astronautId, from, to, limit + 1];
  let cursorSql = '';
  if (after) {
    params.push(after.t, after.id);
    cursorSql = 'AND (x.at, x.id) < ($5::timestamptz, $6::uuid)';
  }
  const { rows } = await db.query(
    `SELECT x.*, ${TS_TEXT('x.at')} AS at_text FROM (
       SELECT 'checkin'::text AS kind, c.id, c.measured_at AS at, c.sleep_hours,
              c.private_note,
              (SELECT jsonb_object_agg(r.indicator_code, r.components->'value')
               FROM readings r WHERE r.wellbeing_checkin_id = c.id AND ${CURRENT_READING}) AS vals,
              NULL::text AS instrument, NULL::text AS fitness, NULL::text AS support_status
       FROM wellbeing_checkins c
       WHERE c.astronaut_id = $1
         AND NOT EXISTS (SELECT 1 FROM wellbeing_checkins n WHERE n.supersedes_id = c.id)
       UNION ALL
       SELECT 'screening', a.id, a.measured_at, NULL, NULL, NULL, i.code, NULL, NULL
       FROM instrument_administrations a JOIN instruments i ON i.id = a.instrument_id
       WHERE a.astronaut_id = $1
       UNION ALL
       SELECT 'pvt_run', p.id, p.measured_at, NULL, NULL, NULL, NULL, p.fitness, NULL
       FROM pvt_runs p WHERE p.astronaut_id = $1
       UNION ALL
       SELECT 'support_request', s.id, s.created_at, NULL, NULL, NULL, NULL, NULL, s.status
       FROM support_requests s WHERE s.astronaut_id = $1
     ) x
     WHERE ($2::timestamptz IS NULL OR x.at >= $2) AND ($3::timestamptz IS NULL OR x.at < $3)
       ${cursorSql}
     ORDER BY x.at DESC, x.id DESC
     LIMIT $4`,
    params,
  );
  return rows;
}

/**
 * Lecturas vigentes (sin corregir) de los deslizadores del astronauta desde `from`, con su
 * check-in. Uso interno: corregir un check-in (supersedes_uuid). No es para mostrar.
 */
async function currentSliderReadings({ astronautId, codes, from }, db = pool) {
  const { rows } = await db.query(
    `SELECT r.id, r.client_uuid, r.recorded_by, r.indicator_code, r.measured_at, r.wellbeing_checkin_id
     FROM readings r
     WHERE r.astronaut_id = $1 AND r.indicator_code = ANY($2::text[]) AND r.measured_at >= $3
       AND r.wellbeing_checkin_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM readings s
                       WHERE s.recorded_by = r.recorded_by AND s.supersedes_uuid = r.client_uuid)
     ORDER BY r.measured_at`,
    [astronautId, codes, from],
  );
  return rows;
}

module.exports = {
  insertCheckin,
  findCheckin,
  currentCheckinOfDay,
  groupEvaluations,
  checkinDays,
  lastCheckinAt,
  recentFitness,
  complianceCounts,
  lastScreenings,
  findGroup,
  activeInstruments,
  historyPage,
  insertPvtRun,
  setPvtFitness,
  pvtFitness,
  insertAdministration,
  activeInstrument,
  currentSliderReadings,
};
