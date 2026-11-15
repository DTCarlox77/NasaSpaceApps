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
     RETURNING id`,
    values,
  );
  if (rows[0]) return { id: rows[0].id, created: true };
  const existing = await db.query(
    `SELECT id FROM ${table} WHERE astronaut_id = $2 AND client_uuid = $1`,
    values.slice(0, 2),
  );
  return { id: existing.rows[0].id, created: false };
}

const insertCheckin = ({ clientUuid, astronautId, measuredAt, sleepHours }, db = pool) =>
  insertGroup(
    'wellbeing_checkins',
    ['measured_at', 'sleep_hours'],
    [clientUuid, astronautId, measuredAt, sleepHours ?? null],
    db,
  );

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
  insertPvtRun,
  setPvtFitness,
  insertAdministration,
  activeInstrument,
  currentSliderReadings,
};
