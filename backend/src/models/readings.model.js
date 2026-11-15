'use strict';

/**
 * Lecturas (append-only) y su evaluación.
 * REGLA: las consultas que muestran datos (al astronauta o al panel) usan la vista
 * v_readings_standard, nunca `readings`. Solo el historial interno del motor (cálculo
 * de derivados, que también necesita los indicadores confidenciales) lee `readings`.
 */
const { pool } = require('../config/db');

// Una lectura "vigente" es la que nadie corrigió (supersedes_uuid) todavía.
const NOT_SUPERSEDED = `NOT EXISTS (
  SELECT 1 FROM readings s WHERE s.recorded_by = r.recorded_by AND s.supersedes_uuid = r.client_uuid)`;

const READING_COLUMNS = `r.id, r.client_uuid, r.supersedes_uuid, r.recorded_by, r.mission_id, r.astronaut_id,
  r.module_id, r.indicator_code, r.components, r.source, r.device_id, r.attachment_id, r.note,
  r.measured_at, r.received_at, r.synthetic,
  (SELECT s.id FROM readings s
    WHERE s.recorded_by = r.recorded_by AND s.supersedes_uuid = r.client_uuid) AS superseded_by`;

const EVALUATION_COLUMNS = `e.level, e.rule_index, e.rules_version, e.recommendation, e.escalation,
  e.basis, e.source_ids, e.derived, e.escalation_id`;

async function findByAuthor(recordedBy, clientUuid, db = pool) {
  const { rows } = await db.query(
    `SELECT ${READING_COLUMNS}, ${EVALUATION_COLUMNS}
     FROM readings r LEFT JOIN reading_evaluations e ON e.reading_id = r.id
     WHERE r.recorded_by = $1 AND r.client_uuid = $2`,
    [recordedBy, clientUuid],
  );
  return rows[0] || null;
}

/** Lectura que se quiere corregir: existe, de qué indicador es y si ya fue corregida. */
async function findSupersedeTarget(recordedBy, clientUuid, db = pool) {
  const { rows } = await db.query(
    `SELECT r.id, r.indicator_code, NOT (${NOT_SUPERSEDED}) AS superseded
     FROM readings r WHERE r.recorded_by = $1 AND r.client_uuid = $2`,
    [recordedBy, clientUuid],
  );
  return rows[0] || null;
}

/**
 * Inserta una lectura. Las de bienestar van agrupadas (como máximo un grupo):
 * wellbeingCheckinId, pvtRunId o instrumentAdministrationId.
 */
async function insert(row, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO readings (client_uuid, recorded_by, mission_id, astronaut_id, module_id,
                           indicator_code, components, source, device_id, attachment_id, note,
                           supersedes_uuid, measured_at, wellbeing_checkin_id, pvt_run_id,
                           instrument_administration_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id`,
    [
      row.clientUuid,
      row.recordedBy,
      row.missionId,
      row.astronautId || null,
      row.moduleId || null,
      row.indicatorCode,
      row.components,
      row.source,
      row.deviceId || null,
      row.attachmentId || null,
      row.note || null,
      row.supersedesUuid || null,
      row.measuredAt,
      row.wellbeingCheckinId || null,
      row.pvtRunId || null,
      row.instrumentAdministrationId || null,
    ],
  );
  const { rows: full } = await db.query(
    `SELECT ${READING_COLUMNS} FROM readings r WHERE r.id = $1`,
    [rows[0].id],
  );
  return full[0];
}

async function saveEvaluation(
  { readingId, indicatorCode, evaluation, derived, escalationId },
  db = pool,
) {
  await db.query(
    `INSERT INTO reading_evaluations (reading_id, indicator_code, level, rule_index, rules_version,
                                      recommendation, escalation, basis, source_ids, derived, escalation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      readingId,
      indicatorCode,
      evaluation.level,
      evaluation.rule_index,
      evaluation.rules_version ?? null,
      evaluation.recommendation ?? null,
      evaluation.escalation,
      evaluation.basis ?? null,
      evaluation.source_ids || [],
      derived || {},
      escalationId || null,
    ],
  );
}

/**
 * Historial interno del motor: lecturas vigentes del mismo indicador y sujeto (astronauta o
 * módulo) anteriores a `before`, de los últimos `days` días. Con `withRest` agrega `rest`
 * (corrida PVT hecha fuera de una tarea crítica).
 */
async function history(
  { indicatorCode, astronautId, missionId, moduleId, before, excludeId, days, withRest = false },
  db = pool,
) {
  const subject = astronautId ? 'r.astronaut_id = $2' : 'r.mission_id = $2 AND r.module_id = $3';
  const params = [indicatorCode, astronautId || missionId];
  if (!astronautId) params.push(moduleId);
  params.push(before, excludeId, days);
  const n = params.length;
  const { rows } = await db.query(
    `SELECT r.components, r.measured_at${withRest ? ', NOT coalesce(p.before_critical_task, true) AS rest' : ''}
     FROM readings r ${withRest ? 'LEFT JOIN pvt_runs p ON p.id = r.pvt_run_id' : ''}
     WHERE r.indicator_code = $1 AND ${subject}
       AND r.measured_at < $${n - 2} AND r.id <> $${n - 1}
       AND r.measured_at >= $${n - 2}::timestamptz - make_interval(days => $${n}::int)
       AND ${NOT_SUPERSEDED}
     ORDER BY r.measured_at DESC
     LIMIT 200`,
    params,
  );
  return rows;
}

/** Primera lectura vigente del astronauta en la misión (línea base de BODY_MASS). */
async function firstInMission({ indicatorCode, astronautId, missionId, excludeId }, db = pool) {
  const { rows } = await db.query(
    `SELECT r.components, r.measured_at FROM readings r
     WHERE r.indicator_code = $1 AND r.astronaut_id = $2 AND r.mission_id = $3 AND r.id <> $4
       AND ${NOT_SUPERSEDED}
     ORDER BY r.measured_at ASC LIMIT 1`,
    [indicatorCode, astronautId, missionId, excludeId],
  );
  return rows[0] || null;
}

/** Sexo biológico del perfil para el contexto de evaluación (null si no está). */
async function astronautSex(astronautId, db = pool) {
  const { rows } = await db.query('SELECT sex FROM astronauts WHERE id = $1', [astronautId]);
  return rows[0] ? rows[0].sex : null;
}

async function missionEndsAt(missionId, db = pool) {
  const { rows } = await db.query('SELECT ends_at FROM missions WHERE id = $1', [missionId]);
  return rows[0] ? rows[0].ends_at : null;
}

async function attachmentOwnedBy(attachmentId, userId, db = pool) {
  const { rows } = await db.query('SELECT 1 FROM attachments WHERE id = $1 AND uploaded_by = $2', [
    attachmentId,
    userId,
  ]);
  return rows.length > 0;
}

/**
 * Serie del astronauta para gráficas (v_readings_standard), ordenada por measured_at e id,
 * con paginación por cursor (keyset). Devuelve limit + 1 filas para saber si hay más.
 */
async function series({ astronautId, code, from, to, after, limit }, db = pool) {
  const { rows } = await db.query(
    `SELECT r.id, r.indicator_code, r.components, r.measured_at, r.received_at, e.level
     FROM v_readings_standard r LEFT JOIN reading_evaluations e ON e.reading_id = r.id
     WHERE r.astronaut_id = $1
       AND ($2::text IS NULL OR r.indicator_code = $2)
       AND ($3::timestamptz IS NULL OR r.measured_at >= $3)
       AND ($4::timestamptz IS NULL OR r.measured_at < $4)
       AND ($5::timestamptz IS NULL OR (r.measured_at, r.id) > ($5::timestamptz, $6::uuid))
       AND ${NOT_SUPERSEDED}
     ORDER BY r.measured_at ASC, r.id ASC
     LIMIT $7`,
    [
      astronautId,
      code || null,
      from || null,
      to || null,
      after ? after.m : null,
      after ? after.id : null,
      limit + 1,
    ],
  );
  return rows;
}

/** Última lectura vigente de cada indicador estándar del astronauta, con su evaluación. */
async function latestForAstronaut(astronautId, db = pool) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (r.indicator_code)
            r.id, r.indicator_code, r.components, r.measured_at, ${EVALUATION_COLUMNS}
     FROM v_readings_standard r LEFT JOIN reading_evaluations e ON e.reading_id = r.id
     WHERE r.astronaut_id = $1 AND ${NOT_SUPERSEDED}
     ORDER BY r.indicator_code, r.measured_at DESC, r.received_at DESC`,
    [astronautId],
  );
  return rows;
}

/** Última lectura vigente de cada indicador por módulo del hábitat (v_readings_standard). */
async function latestHabitat({ missionId, moduleId }, db = pool) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (r.module_id, r.indicator_code)
            r.module_id, r.indicator_code, r.components, r.measured_at, ${EVALUATION_COLUMNS}
     FROM v_readings_standard r LEFT JOIN reading_evaluations e ON e.reading_id = r.id
     WHERE r.mission_id = $1 AND r.module_id IS NOT NULL
       AND ($2::text IS NULL OR r.module_id = $2) AND ${NOT_SUPERSEDED}
     ORDER BY r.module_id, r.indicator_code, r.measured_at DESC, r.received_at DESC`,
    [missionId, moduleId || null],
  );
  return rows;
}

/** Módulo con la lectura del hábitat más reciente de la misión (módulo "actual"). */
async function latestModule(missionId, db = pool) {
  const { rows } = await db.query(
    `SELECT r.module_id FROM v_readings_standard r
     WHERE r.mission_id = $1 AND r.module_id IS NOT NULL
     ORDER BY r.measured_at DESC LIMIT 1`,
    [missionId],
  );
  return rows[0] ? rows[0].module_id : null;
}

/** ¿El astronauta completó hoy (día UTC) el check-in de bienestar? Solo sí/no. */
async function checkinCompletedToday(astronautId, db = pool) {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM wellbeing_checkins
       WHERE astronaut_id = $1 AND measured_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
     ) AS done`,
    [astronautId],
  );
  return rows[0].done;
}

module.exports = {
  findByAuthor,
  findSupersedeTarget,
  insert,
  saveEvaluation,
  history,
  firstInMission,
  missionEndsAt,
  astronautSex,
  attachmentOwnedBy,
  series,
  latestForAstronaut,
  latestHabitat,
  latestModule,
  checkinCompletedToday,
};
