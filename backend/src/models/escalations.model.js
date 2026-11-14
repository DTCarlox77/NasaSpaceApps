'use strict';

const { pool } = require('../config/db');

/**
 * Escalamiento originado por una lectura. A Tierra (flight_surgeon) llega con
 * compute_deliver_at (retraso del entorno + cortes; NULL = en cola esperando enlace);
 * a bordo (crew) llega de inmediato.
 */
async function insertForReading(
  { missionId, astronautId, readingId, level, priority, reason },
  db = pool,
) {
  const { rows } = await db.query(
    `INSERT INTO escalations (mission_id, astronaut_id, source_type, source_id, level, priority,
                              status, reason, deliver_at, category)
     VALUES ($1, $2, 'reading', $3, $4::escalation_level, $5,
             CASE WHEN $4 = 'flight_surgeon' THEN 'queued' ELSE 'delivered' END::escalation_status,
             $6,
             CASE WHEN $4 = 'flight_surgeon' THEN compute_deliver_at($1, now()) ELSE now() END,
             'physical')
     RETURNING id, level, priority, status, deliver_at`,
    [missionId, astronautId || null, readingId, level, priority, reason],
  );
  return rows[0];
}

module.exports = { insertForReading };
