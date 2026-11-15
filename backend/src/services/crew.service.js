'use strict';

/**
 * GET /missions/{id}/crew: tripulación vigente. La ven la tripulación de esa misión, su equipo
 * en Tierra y admin. `sex` pasa por el filtro de accessPolicy (vista clinical_profile): el
 * propio astronauta y flight_surgeon / behavioral_health lo reciben; admin y los demás
 * astronautas, no.
 */
const { badRequest, forbidden, notFound } = require('../utils/httpError');
const { isUuid } = require('../utils/validate');
const { decodeCursor, limitIssue, parseLimit, toPage } = require('../utils/pagination');
const crew = require('../models/crew.model');
const { loadActor, filterAstronautProfile } = require('./accessPolicy');

async function listMissionCrew({ userId, missionId, query }) {
  if (!isUuid(missionId)) throw badRequest([{ field: 'id', issue: 'debe ser un UUID' }]);
  const issue = limitIssue(query.limit);
  if (issue) throw badRequest([{ field: 'limit', issue }]);
  const after = decodeCursor(query.cursor, (v) => typeof v.c === 'string' && isUuid(v.id));
  const limit = parseLimit(query.limit);

  const actor = await loadActor(userId);
  if (!(await crew.missionExists(missionId))) throw notFound('La misión no existe.');
  if (!actor || (actor.role !== 'admin' && !actor.mission_ids.includes(missionId))) {
    throw forbidden(null, 'No formas parte de esa misión.');
  }

  const rows = await crew.currentCrewPage({ missionId, after, limit });
  return toPage(
    rows,
    limit,
    (r) => ({ c: r.call_sign, id: r.astronaut_id }),
    (r) =>
      filterAstronautProfile(
        actor,
        {
          astronaut_id: r.astronaut_id,
          user_id: r.user_id,
          call_sign: r.call_sign,
          full_name: r.full_name,
          crew_role: r.crew_role,
          assigned_from: r.assigned_from,
          sex: r.sex,
        },
        { astronautId: r.astronaut_id, missionId },
      ),
  );
}

module.exports = { listMissionCrew };
