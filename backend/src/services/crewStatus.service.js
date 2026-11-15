'use strict';

/**
 * Pantalla "Tripulación" de la app (GET /crew/status): solo astronautas con asignación vigente,
 * datos de su misión. Quién ve qué lo decide canAccess (vistas crew_status y crew_physical):
 * - toda la tripulación: roster, la sesión de emergencia abierta de la misión (id y estado) y
 *   las alertas físicas ya escaladas a bordo (level crew) en las últimas 24 h, sin valores;
 * - solo el oficial médico (CMO): además, el semáforo físico de cada tripulante (peor nivel por
 *   zona y, por indicador estándar, nivel, último valor y hora), de v_readings_standard. Sin
 *   SLEEP_HOURS: llega con el check-in y diría quién lo hizo y a qué hora (cumplimiento).
 * Nunca bienestar (WB_*, PHQ2/GAD2, PVT_*, aptitud), check-ins, solicitudes de apoyo,
 * escalamientos conductuales, sex ni notas. Tierra y service → 403 (tienen el panel).
 */
const { HttpError, forbidden } = require('../utils/httpError');
const { LEVEL_ORDER } = require('../engine/conditions');
const missions = require('../models/missions.model');
const model = require('../models/crewStatus.model');
const catalog = require('./catalog.service');
const { loadActor, canAccess } = require('./accessPolicy');

const ALERT_WINDOW_HOURS = 24;

const worst = (levels) =>
  levels.reduce((acc, l) => (LEVEL_ORDER[l] > LEVEL_ORDER[acc] ? l : acc), 'unrated');

/**
 * Semáforo físico de un tripulante (pura). Como GET /me/body-status: por zona del cuerpo, el
 * peor nivel de la última lectura de sus indicadores estándar (SYMPTOM cuenta en la zona de
 * cada síntoma reportado; zona sin lecturas = unrated). `indicators` = los que canAccess deja
 * ver (sin SLEEP_HOURS: brain solo lo colorea SYMPTOM); salen solo los que tienen lectura, en
 * el orden del catálogo. Lo confidencial no entra (solo indicadores estándar).
 */
function physicalSummary({ zones, indicators, symptomZones, rows }) {
  const byCode = new Map(rows.map((r) => [r.indicator_code, r]));
  const body = zones.filter((z) => z.code !== 'environment' && z.code !== 'by_symptom');
  const levels = new Map(body.map((z) => [z.code, []]));
  const shown = indicators.filter((i) => i.sensitivity === 'standard' && byCode.has(i.code));

  for (const indicator of shown) {
    const row = byCode.get(indicator.code);
    const level = row.level || 'unrated';
    if (levels.has(indicator.body_zone)) levels.get(indicator.body_zone).push(level);
    if (indicator.code === 'SYMPTOM' && Array.isArray(row.components.symptoms)) {
      for (const zone of new Set(row.components.symptoms.map((s) => symptomZones.get(s)))) {
        if (levels.has(zone)) levels.get(zone).push(level);
      }
    }
  }

  return {
    zones: [...levels].map(([zone, list]) => ({ zone, worst_level: worst(list) })),
    indicators: shown.map((indicator) => {
      const row = byCode.get(indicator.code);
      return {
        code: indicator.code,
        level: row.level || 'unrated',
        last_value: row.components,
        measured_at: row.measured_at,
      };
    }),
  };
}

const groupBy = (rows, key) => {
  const out = new Map();
  for (const row of rows) {
    if (!out.has(row[key])) out.set(row[key], []);
    out.get(row[key]).push(row);
  }
  return out;
};

async function crewStatus({ userId }) {
  const actor = await loadActor(userId);
  if (!actor) throw forbidden();
  const missionId = actor.mission_ids[0] ?? null;

  const allowed = (astronautId, view, category = 'physical', indicatorCode = undefined) =>
    canAccess(actor, {
      astronaut_id: astronautId,
      mission_id: missionId,
      sensitivity: 'standard',
      category,
      action: 'read',
      view,
      indicator_code: indicatorCode,
    });

  // astronaut_id representativo ("un tripulante"): la pantalla es de toda la misión.
  if (!allowed('*', 'crew_status')) {
    if (actor.role === 'astronaut' && !missionId) {
      throw new HttpError(
        403,
        'NO_ACTIVE_ASSIGNMENT',
        'No tienes una asignación de misión vigente.',
      );
    }
    throw forbidden(null, 'Esta pantalla es de la tripulación a bordo; Tierra usa el panel.');
  }

  const [mission, crew] = await Promise.all([
    missions.findMission(missionId),
    model.currentCrew(missionId),
  ]);
  const ids = crew.map((m) => m.astronaut_id);
  const alertIds = ids.filter((id) => allowed(id, 'crew_status'));
  const physicalIds = ids.filter((id) => allowed(id, 'crew_physical'));
  // Indicadores del semáforo que el actor puede ver de cada tripulante (canAccess por
  // indicador): de la base solo se leen esos.
  const standard = physicalIds.length ? await catalog.standardIndicators() : [];
  const visibleBy = new Map(
    physicalIds.map((id) => [
      id,
      standard.filter((i) => allowed(id, 'crew_physical', 'physical', i.code)),
    ]),
  );
  const codes = [...new Set([...visibleBy.values()].flat().map((i) => i.code))];

  const [session, alerts, readings, zones, symptomZones] = await Promise.all([
    allowed('*', 'crew_status', 'emergency') ? model.openEmergency(missionId) : null,
    alertIds.length
      ? model.crewAlerts({ missionId, astronautIds: alertIds, hours: ALERT_WINDOW_HOURS })
      : [],
    codes.length ? model.latestPhysical({ missionId, astronautIds: physicalIds, codes }) : [],
    physicalIds.length ? catalog.zoneList() : [],
    physicalIds.length ? catalog.symptomZones() : new Map(),
  ]);
  const alertsBy = groupBy(alerts, 'astronaut_id');
  const readingsBy = groupBy(readings, 'astronaut_id');
  const alertSet = new Set(alertIds);

  return {
    mission: { id: mission.id, code: mission.code },
    generated_at: new Date().toISOString(),
    viewer_crew_role: actor.crew_role,
    crew: crew.map((member) => ({
      astronaut_id: member.astronaut_id,
      call_sign: member.call_sign,
      display_name: member.full_name,
      crew_role: member.crew_role,
      // Una sola sesión abierta por misión y cubre a toda la tripulación: la misma en cada fila.
      emergency: session ? { session_id: session.id, status: session.status } : null,
      crew_alerts: alertSet.has(member.astronaut_id)
        ? (alertsBy.get(member.astronaut_id) || []).map((a) => ({
            escalation_id: a.escalation_id,
            indicator_code: a.indicator_code,
            indicator_name: a.indicator_name,
            level: a.level,
            created_at: a.created_at,
          }))
        : [],
      physical: visibleBy.has(member.astronaut_id)
        ? physicalSummary({
            zones,
            indicators: visibleBy.get(member.astronaut_id),
            symptomZones,
            rows: readingsBy.get(member.astronaut_id) || [],
          })
        : null,
    })),
  };
}

module.exports = { crewStatus, physicalSummary, ALERT_WINDOW_HOURS };
