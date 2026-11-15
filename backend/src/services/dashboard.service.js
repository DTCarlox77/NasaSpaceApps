'use strict';

/**
 * Dashboard de tripulación (GET /admin/dashboard/crew): semáforo FÍSICO por astronauta e
 * indicador, con último valor, serie y tendencia. Sin estado conductual: las lecturas salen
 * de v_readings_standard. `compliance` y `fitness` solo si accessPolicy lo permite
 * (fitness: flight_surgeon y admin; compliance: solo admin); si no, null.
 * `fitness` = aptitud para tarea crítica con una PVT reciente (WELLBEING_FITNESS_MAX_AGE_H,
 * tarea 10): sin PVT reciente, not_confirmed. Igual que GET /admin/compliance.
 */
const { LEVEL_ORDER } = require('../engine/conditions');
const dashboard = require('../models/dashboard.model');
const { loadActor, canAccess, enforceAccess } = require('./accessPolicy');
const { resolveMission } = require('./missionScope');
const { fitnessByAstronaut } = require('./wellbeing.service');
const { forbidden } = require('../utils/httpError');

const SERIES_POINTS = 10;
const TREND_THRESHOLD = 0.05; // ±5 % frente a la media de los puntos anteriores
const DAY_MS = 24 * 60 * 60 * 1000;

const worst = (levels) =>
  levels.reduce((acc, l) => (LEVEL_ORDER[l] > LEVEL_ORDER[acc] ? l : acc), 'unrated');

/** Valor principal para la gráfica: value, la sistólica, o el primer componente numérico. */
function primaryValue(components) {
  if (!components || typeof components !== 'object') return null;
  if (typeof components.value === 'number') return components.value;
  if (typeof components.systolic === 'number') return components.systolic;
  const first = Object.values(components).find((v) => typeof v === 'number');
  return first === undefined ? null : first;
}

/**
 * Tendencia (regla de diseño): último valor frente a la media de los anteriores de la serie.
 * Menos de 2 puntos = insufficient_data.
 */
function trendOf(series) {
  if (series.length < 2) return 'insufficient_data';
  const last = series[series.length - 1].value;
  const previous = series.slice(0, -1).map((p) => p.value);
  const mean = previous.reduce((a, b) => a + b, 0) / previous.length;
  const change = mean === 0 ? last - mean : (last - mean) / Math.abs(mean);
  if (change > TREND_THRESHOLD) return 'rising';
  if (change < -TREND_THRESHOLD) return 'falling';
  return 'stable';
}

function toIndicator(code, rows) {
  const last = rows[rows.length - 1];
  const series = rows
    .map((r) => ({ measured_at: r.measured_at, value: primaryValue(r.components) }))
    .filter((p) => p.value !== null);
  return {
    code,
    level: last.level || 'unrated',
    last_value: last.components,
    measured_at: last.measured_at,
    trend: trendOf(series),
    series,
  };
}

/** Check-ins esperados en 7 días: los días de la asignación, hasta 7 (mínimo 1). */
function expectedCheckins(assignedFrom, now = Date.now()) {
  const days = Math.ceil((now - new Date(assignedFrom).getTime()) / DAY_MS);
  return Math.min(7, Math.max(1, days));
}

async function crewDashboard({ userId, missionId }) {
  const actor = await loadActor(userId);
  if (!actor) throw forbidden();
  const mission = await resolveMission(actor, missionId);
  const crew = await dashboard.currentCrew(mission.id);

  const physical = (astronautId) => ({
    astronaut_id: astronautId,
    mission_id: mission.id,
    sensitivity: 'standard',
    category: 'physical',
    action: 'read',
  });
  // Sin tripulación también se verifica el permiso sobre la misión.
  await enforceAccess(actor, physical(crew[0] ? crew[0].astronaut_id : '*'));
  for (const member of crew) await enforceAccess(actor, physical(member.astronaut_id));

  const aggregate = (astronautId, view) =>
    canAccess(actor, {
      astronaut_id: astronautId,
      mission_id: mission.id,
      sensitivity: 'standard',
      category: 'behavioral',
      action: 'read',
      view,
    });

  const ids = crew.map((m) => m.astronaut_id);
  const [readings, checkins, fitness] = ids.length
    ? await Promise.all([
        dashboard.recentPhysicalReadings({
          missionId: mission.id,
          astronautIds: ids,
          perIndicator: SERIES_POINTS,
        }),
        dashboard.checkinDays7d(ids),
        fitnessByAstronaut(ids),
      ])
    : [[], new Map(), new Map()];

  const byAstronaut = new Map(ids.map((id) => [id, new Map()]));
  for (const row of readings) {
    const byCode = byAstronaut.get(row.astronaut_id);
    if (!byCode.has(row.indicator_code)) byCode.set(row.indicator_code, []);
    byCode.get(row.indicator_code).push(row);
  }

  return {
    mission_id: mission.id,
    mission_code: mission.code,
    generated_at: new Date().toISOString(),
    astronauts: crew.map((member) => {
      const indicators = [...byAstronaut.get(member.astronaut_id)].map(([code, rows]) =>
        toIndicator(code, rows),
      );
      return {
        astronaut_id: member.astronaut_id,
        call_sign: member.call_sign,
        crew_role: member.crew_role,
        worst_level: worst(indicators.map((i) => i.level)),
        indicators,
        compliance: aggregate(member.astronaut_id, 'compliance')
          ? {
              // La ventana de 7 × 24 h puede tocar 8 días UTC: se limita a 7.
              checkins_completed_7d: Math.min(7, checkins.get(member.astronaut_id) || 0),
              checkins_expected_7d: expectedCheckins(member.assigned_from),
            }
          : null,
        fitness: aggregate(member.astronaut_id, 'fitness')
          ? fitness.get(member.astronaut_id) || 'not_confirmed'
          : null,
      };
    }),
  };
}

module.exports = { crewDashboard, trendOf, primaryValue, expectedCheckins };
