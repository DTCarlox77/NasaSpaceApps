'use strict';

/**
 * Misión de una consulta del panel (`mission_id` del contrato, MissionIdQuery):
 * - si viene, debe existir (404) y ser UUID (400);
 * - si no, la misión activa más reciente del equipo en Tierra del usuario;
 * - admin es global: si no es parte de ningún equipo, la misión activa más reciente.
 * Que el usuario pueda ver la misión lo decide después accessPolicy (sameMission).
 */
const { HttpError, notFound } = require('../utils/httpError');
const { uuidParam } = require('../utils/validate');
const { pool } = require('../config/db');
const missions = require('../models/missions.model');

async function resolveMission(actor, missionId, db = pool) {
  if (missionId !== undefined) {
    const mission = await missions.findMission(uuidParam(missionId, 'mission_id'), db);
    if (!mission) throw notFound('La misión no existe.');
    return mission;
  }
  if (actor.mission_ids.length) {
    const { rows } = await db.query(
      `SELECT id, code, name, environment_code, status, starts_at, ends_at
       FROM missions WHERE id = ANY($1::uuid[])
       ORDER BY (status = 'active') DESC, starts_at DESC, id LIMIT 1`,
      [actor.mission_ids],
    );
    if (rows[0]) return rows[0];
  }
  if (actor.role === 'admin') {
    const mission = await missions.defaultMission(db);
    if (mission) return mission;
    throw notFound('No hay misiones registradas.');
  }
  throw new HttpError(
    403,
    'NO_ACTIVE_ASSIGNMENT',
    'No eres parte del equipo en Tierra de ninguna misión.',
  );
}

module.exports = { resolveMission };
