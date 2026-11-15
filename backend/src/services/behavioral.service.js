'use strict';

/**
 * Salud conductual (tarea 10), solo behavioral_health:
 * - GET /admin/behavioral/inbox: escalamientos conductuales y solicitudes de apoyo ya
 *   entregados en Tierra (deliver_at <= now()), con estado, urgencia, measured_at y deliver_at;
 * - GET /admin/behavioral/astronauts/{id}: check-ins (sin la nota privada), tendencias, z,
 *   cuestionarios, PVT, solicitudes y escalamientos abiertos;
 * - POST /admin/behavioral/escalations/{id}/ack y /close.
 * Cada lectura de datos confidenciales queda en confidential_access_log (una fila por
 * astronauta que aparece en la bandeja; una por consulta del detalle).
 * Admin vive en /admin/compliance (cumplimiento y aptitud): sin valores, tendencias ni
 * solicitudes.
 */
const { badRequest, conflict, forbidden, notFound } = require('../utils/httpError');
const { isUuid, uuidParam } = require('../utils/validate');
const {
  decodeCursor,
  limitIssue,
  parseLimit,
  toPage,
  isTimestampText,
} = require('../utils/pagination');
const { withTransaction } = require('../models/transaction');
const behavioral = require('../models/behavioral.model');
const escalations = require('../models/escalations.model');
const wellbeing = require('../models/wellbeing.model');
const dashboard = require('../models/dashboard.model');
const catalog = require('./catalog.service');
const delivery = require('./escalationDelivery.service');
const { trendOf } = require('./dashboard.service');
const { loadActor, canAccess, enforceAccess, logConfidentialAccess } = require('./accessPolicy');
const { resolveMission } = require('./missionScope');
const { toSupportRequest } = require('./supportRequest.service');
const { fitnessByAstronaut, streakFrom } = require('./wellbeing.service');

const DAY_MS = 24 * 60 * 60 * 1000;
const WB_CODES = ['WB_MOOD', 'WB_FATIGUE', 'WB_STRESS', 'WB_CREW_CONFLICT'];
const SCREENING_CODES = ['PHQ2_SCORE', 'GAD2_SCORE'];
const DETAIL_DAYS = 30;
const SERIES_POINTS = 14;

const INBOX_LABEL = 'GET /api/v1/admin/behavioral/inbox';
const DETAIL_LABEL = 'GET /api/v1/admin/behavioral/astronauts/{id}';

const confidential = (astronautId, missionId, action = 'read') => ({
  astronaut_id: astronautId,
  mission_id: missionId,
  sensitivity: 'confidential',
  category: 'behavioral',
  action,
});

async function bhActor(userId) {
  const actor = await loadActor(userId);
  if (!actor || actor.role !== 'behavioral_health') throw forbidden();
  return actor;
}

// ---------------------------------------------------------------- bandeja

const shortName = (name) => String(name || '').replace(/\s*\(check-in\)\s*$/i, '');
const LEVEL_ES = {
  critical: 'crítico',
  caution: 'precaución',
  normal: 'normal',
  unrated: 'sin calificar',
};

/** Resumen para behavioral_health (puede nombrar días y nivel: el detalle es suyo). */
async function summaryFor(row) {
  if (row.source === 'support') {
    const how = row.channel === 'session' ? 'pide una sesión' : 'por mensaje';
    return `Solicitud de apoyo ${how}${row.urgency === 'now' ? ' (ahora)' : ''}`;
  }
  const indicator = row.indicator_code ? await catalog.getIndicator(row.indicator_code) : null;
  const name = indicator ? shortName(indicator.name) : 'Bienestar';
  if (row.indicator_code && row.indicator_code.startsWith('WB_')) {
    const days = row.ev_derived && row.ev_derived.adverse_sustained_days;
    return Number.isInteger(days)
      ? `${name} distinto de lo habitual durante ${days} check-ins seguidos`
      : `${name} distinto de lo habitual`;
  }
  if (SCREENING_CODES.includes(row.indicator_code)) {
    return `${name}: en el punto de corte o por encima (antes de la conferencia privada)`;
  }
  return `${name}: nivel ${LEVEL_ES[row.ev_level] || row.ev_level || 'de alerta'}`;
}

async function toInboxItem(row) {
  const isSupport = row.source === 'support';
  return {
    id: row.id,
    astronaut_id: row.astronaut_id,
    call_sign: row.call_sign,
    kind: isSupport
      ? 'support_request'
      : SCREENING_CODES.includes(row.indicator_code)
        ? 'screening_alert'
        : 'wellbeing_alert',
    indicator_code: row.indicator_code ?? null,
    urgency: row.urgency ?? null,
    channel: row.channel ?? null,
    priority: row.priority ?? null,
    status: row.status,
    summary: await summaryFor(row),
    created_at: row.created_at,
    measured_at: row.measured_at,
    deliver_at: row.deliver_at,
  };
}

async function inbox({ userId, query, req }) {
  const problems = [];
  const limitProblem = limitIssue(query.limit);
  if (limitProblem) problems.push({ field: 'limit', issue: limitProblem });
  if (query.include_closed !== undefined && !['true', 'false'].includes(query.include_closed)) {
    problems.push({ field: 'include_closed', issue: 'debe ser true o false' });
  }
  if (problems.length) throw badRequest(problems);
  const limit = parseLimit(query.limit);
  const after = decodeCursor(
    query.cursor,
    (c) => Number.isInteger(c.r) && isTimestampText(c.d) && isUuid(c.id),
  );
  const actor = await bhActor(userId);
  const mission = await resolveMission(actor, query.mission_id);
  if (!canAccess(actor, confidential('*', mission.id))) {
    throw forbidden(null, 'No tienes permiso para ver esta bandeja.');
  }
  await delivery.promoteDelivered(mission.id);
  const rows = await behavioral.inboxPage({
    missionId: mission.id,
    includeClosed: query.include_closed === 'true',
    after,
    limit,
  });
  const page = rows.slice(0, limit);
  for (const astronautId of new Set(page.map((r) => r.astronaut_id))) {
    await logConfidentialAccess(actor, astronautId, INBOX_LABEL, req);
  }
  const items = [];
  for (const row of page) items.push(await toInboxItem(row));
  const { next_cursor: nextCursor } = toPage(rows, limit, (r) => ({
    r: r.rank,
    d: r.deliver_at_text,
    id: r.id,
  }));
  return { items, next_cursor: nextCursor };
}

// ---------------------------------------------------------------- detalle

const num = (v) => (v == null ? null : Number(v));

function indicatorDetail(code, rows) {
  const last = rows[rows.length - 1];
  const derived = (last && last.derived) || {};
  const series = rows
    .slice(-SERIES_POINTS)
    .map((r) => ({ measured_at: r.measured_at, value: num(r.components && r.components.value) }))
    .filter((p) => p.value !== null);
  return {
    code,
    level: last ? last.level || 'unrated' : 'unrated',
    escalation: last ? last.escalation || 'self_care' : 'self_care',
    last_value: last ? num(last.components && last.components.value) : null,
    adverse_z_3d: typeof derived.adverse_z_3d === 'number' ? derived.adverse_z_3d : null,
    adverse_sustained_days: Number.isInteger(derived.adverse_sustained_days)
      ? derived.adverse_sustained_days
      : 0,
    baseline_ready: derived.baseline_ready === true,
    trend: trendOf(series),
    series,
  };
}

async function astronautDetail({ userId, id, req }) {
  const astronautId = uuidParam(id);
  const actor = await bhActor(userId);
  const astronaut = await behavioral.astronautWithMissions(astronautId);
  if (!astronaut) throw notFound('El astronauta no existe.');
  const missionId =
    astronaut.mission_ids.find((m) => actor.mission_ids.includes(m)) ||
    astronaut.mission_ids[0] ||
    null;
  // 403 si no es de una misión suya; si sí, la consulta queda en la bitácora.
  await enforceAccess(actor, confidential(astronautId, missionId), { req, label: DETAIL_LABEL });

  const since = new Date(Date.now() - DETAIL_DAYS * DAY_MS).toISOString();
  const [readings, checkins, screenings, pvtRuns, requests, open] = await Promise.all([
    behavioral.indicatorReadings({ astronautId, codes: WB_CODES, since }),
    behavioral.checkins({ astronautId, since, limit: SERIES_POINTS }),
    behavioral.screenings({ astronautId, limit: 10 }),
    behavioral.pvtRuns({ astronautId, limit: 10 }),
    behavioral.deliveredSupportRequests({ astronautId, limit: 20 }),
    behavioral.openEscalations(astronautId),
  ]);
  const byCode = new Map(WB_CODES.map((c) => [c, []]));
  for (const r of readings) byCode.get(r.indicator_code).push(r);
  const indicators = WB_CODES.map((code) => indicatorDetail(code, byCode.get(code)));

  return {
    astronaut: { id: astronaut.id, call_sign: astronaut.call_sign },
    generated_at: new Date().toISOString(),
    baseline_ready: indicators.some((i) => i.baseline_ready),
    indicators: indicators.map(({ baseline_ready: _ready, ...rest }) => rest),
    checkins: checkins.map((c) => {
      const v = c.vals || {};
      return {
        id: c.id,
        measured_at: c.measured_at,
        received_at: c.received_at,
        mood: v.WB_MOOD ?? null,
        fatigue: v.WB_FATIGUE ?? null,
        stress: v.WB_STRESS ?? null,
        crew_conflict: v.WB_CREW_CONFLICT ?? null,
        sleep_hours: num(c.sleep_hours),
        supersedes_id: c.supersedes_id,
      };
    }),
    screenings: screenings.map((s) => ({
      id: s.id,
      instrument: s.instrument,
      score: s.score,
      item_1: s.answers.item_1,
      item_2: s.answers.item_2,
      level: s.level || 'unrated',
      measured_at: s.measured_at,
    })),
    pvt_runs: pvtRuns.map((p) => {
      const v = p.vals || {};
      return {
        id: p.id,
        device_id: p.device_id,
        measured_at: p.measured_at,
        lapses: v.PVT_LAPSES ?? null,
        mean_rt_ms: v.PVT_MEAN_RT ?? null,
        false_starts: v.PVT_FALSE_STARTS ?? null,
        before_critical_task: p.before_critical_task,
        fitness: p.fitness,
      };
    }),
    support_requests: requests.map(toSupportRequest),
    escalations: open,
  };
}

// ---------------------------------------------------------------- acuse y cierre

async function lockBehavioralEscalation(actor, id, db) {
  const esc = await escalations.lockById(uuidParam(id), db);
  if (!esc || esc.level !== 'behavioral_health' || !esc.delivered) {
    throw notFound('El escalamiento no existe o todavía no llegó a Tierra.');
  }
  await enforceAccess(actor, confidential(esc.astronaut_id, esc.mission_id, 'write'), { db });
  return esc;
}

async function acknowledgeEscalation({ userId, id }) {
  const actor = await bhActor(userId);
  return withTransaction(async (db) => {
    const esc = await lockBehavioralEscalation(actor, id, db);
    if (esc.status === 'closed') {
      throw conflict('CONFLICT', 'El escalamiento ya está cerrado.', { status: esc.status });
    }
    return escalations.acknowledge(esc.id, userId, db);
  });
}

/** Cierre: a partir de aquí, un cambio que siga sostenido puede volver a escalar. */
async function closeEscalation({ userId, id }) {
  const actor = await bhActor(userId);
  return withTransaction(async (db) => {
    const esc = await lockBehavioralEscalation(actor, id, db);
    return escalations.close(esc.id, userId, db);
  });
}

// ---------------------------------------------------------------- cumplimiento (admin)

/**
 * GET /admin/compliance: por astronauta de la tripulación vigente, cumplimiento y aptitud.
 * Solo conteos y horas (check-in hoy, último check-in, racha, cuestionarios y PVT hechos) y
 * fit | not_confirmed. Sin valores, tendencias, niveles ni solicitudes de apoyo.
 */
async function compliance({ userId, query }) {
  const problems = [];
  for (const field of ['from', 'to']) {
    if (query[field] !== undefined && Number.isNaN(Date.parse(query[field]))) {
      problems.push({ field, issue: 'debe ser una fecha ISO 8601' });
    }
  }
  if (problems.length) throw badRequest(problems);
  const nowMs = Date.now();
  const todayStart = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const to = query.to ? Date.parse(query.to) : nowMs;
  const from = query.from ? Date.parse(query.from) : todayStart - 6 * DAY_MS;
  if (from >= to) throw badRequest([{ field: 'from', issue: 'debe ser anterior a to' }]);
  if (to - from > 366 * DAY_MS) {
    throw badRequest([{ field: 'from', issue: 'el rango máximo es de 366 días' }]);
  }

  const actor = await loadActor(userId);
  if (!actor) throw forbidden();
  const mission = await resolveMission(actor, query.mission_id);
  const crew = await dashboard.currentCrew(mission.id);
  const view = (astronautId, v) => ({
    astronaut_id: astronautId,
    mission_id: mission.id,
    sensitivity: 'standard',
    category: 'behavioral',
    action: 'read',
    view: v,
  });
  await enforceAccess(actor, view(crew[0] ? crew[0].astronaut_id : '*', 'compliance'));
  for (const m of crew) await enforceAccess(actor, view(m.astronaut_id, 'compliance'));

  const ids = crew.map((m) => m.astronaut_id);
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();
  const [done, days, counts, fitness] = ids.length
    ? await Promise.all([
        behavioral.checkinDaysBetween(ids, fromIso, toIso),
        wellbeing.checkinDays(ids, new Date(todayStart - 400 * DAY_MS).toISOString()),
        wellbeing.complianceCounts(ids, fromIso, toIso),
        fitnessByAstronaut(ids, nowMs),
      ])
    : [new Map(), new Map(), new Map(), new Map()];
  const last = ids.length ? await wellbeing.lastCheckinAt(ids) : new Map();
  const todayIso = new Date(todayStart).toISOString().slice(0, 10);

  return {
    mission_id: mission.id,
    from: fromIso,
    to: toIso,
    generated_at: new Date(nowMs).toISOString(),
    astronauts: crew.map((m) => {
      const own = days.get(m.astronaut_id);
      const expected = expectedDays(from, to, m.assigned_from);
      return {
        astronaut_id: m.astronaut_id,
        call_sign: m.call_sign,
        checkin_today: Boolean(own && own.days.includes(todayIso)),
        checkins_completed: Math.min(expected, done.get(m.astronaut_id) || 0),
        checkins_expected: expected,
        streak_days: streakFrom(own ? own.days : [], nowMs).streak_days,
        last_checkin_at: last.get(m.astronaut_id) || null,
        screenings_completed: (counts.get(m.astronaut_id) || {}).screenings || 0,
        pvt_runs: (counts.get(m.astronaut_id) || {}).pvt_runs || 0,
        fitness: canAccess(actor, view(m.astronaut_id, 'fitness'))
          ? fitness.get(m.astronaut_id) || 'not_confirmed'
          : 'not_confirmed',
      };
    }),
  };
}

/** Días UTC del rango [from, to) desde el inicio de la asignación (un check-in por día). */
function expectedDays(fromMs, toMs, assignedFrom) {
  const start = Math.max(fromMs, new Date(assignedFrom).getTime());
  if (start >= toMs) return 0;
  const firstDay = Math.floor(start / DAY_MS);
  const lastDay = Math.floor((toMs - 1) / DAY_MS);
  return lastDay - firstDay + 1;
}

module.exports = {
  inbox,
  astronautDetail,
  acknowledgeEscalation,
  closeEscalation,
  compliance,
  expectedDays,
};
