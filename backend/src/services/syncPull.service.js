'use strict';

/**
 * GET /sync/pull (tarea 8): lo nuevo para la app del astronauta desde su cursor.
 *
 * Flujos incrementales (cada uno con su marca keyset dentro del cursor):
 *   e  evaluaciones de SUS lecturas estándar (v_readings_standard: nunca bienestar);
 *   s  sus escalamientos no confidenciales que ya llegaron (deliver_at <= ahora);
 *   m  mensajes de Tierra en esos escalamientos, ya entregados (durante un corte, nada);
 *   p  respuestas a sus solicitudes de apoyo (suyas), ya entregadas.
 * Estado (en cada respuesta): versión de reglas, protocolo, catálogo y misión (con `changed`
 * respecto de lo que trae el cursor), recordatorios pendientes y rutinas activas.
 *
 * El cursor es opaco (base64url) y monótono: con el mismo cursor sale lo mismo. Solo se lee
 * hasta now() − SYNC_PULL_SETTLE_MS, así una transacción que confirma tarde no queda atrás.
 */
const env = require('../config/env');
const { HttpError, badRequest } = require('../utils/httpError');
const { isUuid } = require('../utils/validate');
const { encodeCursor, decodeCursor, limitIssue, parseLimit } = require('../utils/pagination');
const sync = require('../models/sync.model');
const catalog = require('./catalog.service');
const { toEvaluation } = require('./readingRecorder');
const { loadActor } = require('./accessPolicy');

const STREAMS = ['e', 's', 'm', 'p'];
const FETCH = {
  e: sync.evaluationsPage,
  s: sync.escalationsPage,
  m: sync.escalationMessagesPage,
  p: sync.supportMessagesPage,
};

const isKey = (k) =>
  k === null ||
  (Array.isArray(k) &&
    k.length === 2 &&
    typeof k[0] === 'string' &&
    !Number.isNaN(Date.parse(k[0])) &&
    isUuid(k[1]));

const validCursor = (c) =>
  c.v === 1 && c.k && typeof c.k === 'object' && STREAMS.every((s) => isKey(c.k[s] ?? null));

const lagFor = (row) =>
  Math.max(0, Math.round((new Date(row.received_at) - new Date(row.measured_at)) / 1000));

function toItem(stream, row) {
  if (stream === 'e') {
    const lag = lagFor(row);
    return {
      reading_id: row.id,
      client_uuid: row.client_uuid,
      supersedes_uuid: row.supersedes_uuid,
      indicator_code: row.indicator_code,
      measured_at: row.measured_at,
      received_at: row.received_at,
      evaluation: toEvaluation(row.indicator_code, row),
      escalation_id: row.escalation_id || null,
      late_sync: lag > env.sync.lateAfterS,
      lag_s: lag,
    };
  }
  if (stream === 's') {
    return {
      id: row.id,
      source_type: row.source_type,
      source_id: row.source_id,
      level: row.level,
      priority: row.priority,
      // Lo que ya llegó pero sigue queued se muestra como delivered (igual que la bandeja).
      status: row.status === 'queued' ? 'delivered' : row.status,
      reason: row.reason,
      created_at: row.created_at,
      deliver_at: row.deliver_at,
    };
  }
  return {
    id: row.id,
    channel: stream === 'm' ? 'escalation' : 'support',
    thread_id: row.thread_id,
    direction: row.direction,
    author_role: row.author_role,
    body: row.body,
    created_at: row.created_at,
    deliver_at: row.deliver_at,
  };
}

async function pull({ auth, query }) {
  const issue = limitIssue(query.limit);
  if (issue) throw badRequest([{ field: 'limit', issue }]);
  const limit = parseLimit(query.limit);
  const cursor = decodeCursor(query.cursor, validCursor);

  const actor = await loadActor(auth.userId);
  if (!actor || actor.role !== 'astronaut' || !actor.astronaut_id || !actor.mission_ids.length) {
    throw new HttpError(403, 'NO_ACTIVE_ASSIGNMENT', 'No tienes una asignación de misión vigente.');
  }
  const astronautId = actor.astronaut_id;
  const keys = Object.fromEntries(STREAMS.map((s) => [s, cursor ? (cursor.k[s] ?? null) : null]));
  const { server_time: serverTime, horizon } = await sync.horizon(env.sync.pullSettleMs);

  const pages = await Promise.all(
    STREAMS.map((s) =>
      FETCH[s]({ astronautId, missionId: actor.mission_ids[0], horizon, key: keys[s], limit }),
    ),
  );
  const merged = STREAMS.flatMap((s, i) => pages[i].map((row) => ({ s, order: i, row })));
  merged.sort(
    (a, b) =>
      new Date(a.row.ts) - new Date(b.row.ts) ||
      a.order - b.order ||
      (a.row.ts_text < b.row.ts_text ? -1 : a.row.ts_text > b.row.ts_text ? 1 : 0) ||
      (a.row.id < b.row.id ? -1 : 1),
  );
  const taken = merged.slice(0, limit);
  const next = { ...keys };
  for (const { s, row } of taken) next[s] = [row.ts_text, row.id];

  const [rulesVersion, protocol, mission, reminders, routines] = await Promise.all([
    catalog.rulesVersion(),
    sync.activeProtocol(),
    sync.missionState(actor.mission_ids[0]),
    sync.pendingReminders(astronautId),
    sync.activeRoutines(astronautId),
  ]);
  const versions = {
    rv: rulesVersion,
    pv: protocol ? `${protocol.code}:${protocol.version}` : null,
    cv: catalog.CATALOG_VERSION,
    mv: mission ? mission.version : null,
  };
  const changed = (k) => !cursor || cursor[k] !== versions[k];
  const of = (s) => taken.filter((t) => t.s === s).map((t) => toItem(s, t.row));

  return {
    cursor: encodeCursor({ v: 1, k: next, ...versions }),
    has_more: merged.length > limit,
    server_time: serverTime,
    rules: { rules_version: rulesVersion, changed: changed('rv') },
    protocol: protocol
      ? { code: protocol.code, version: protocol.version, changed: changed('pv') }
      : { code: null, version: null, changed: false },
    catalog: { catalog_version: catalog.CATALOG_VERSION, changed: changed('cv') },
    mission: mission
      ? {
          id: mission.id,
          code: mission.code,
          status: mission.status,
          ends_at: mission.ends_at,
          comm_delay_seconds: mission.comm_delay_seconds,
          link: mission.outage_active
            ? { status: 'outage', outage_ends_at: mission.outage_ends_at }
            : { status: 'up', outage_ends_at: null },
          version: mission.version,
          changed: changed('mv'),
        }
      : null,
    evaluations: of('e'),
    escalations: of('s'),
    messages: taken.filter((t) => t.s === 'm' || t.s === 'p').map((t) => toItem(t.s, t.row)),
    reminders: reminders.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      due_at: r.due_at,
      indicator_code: r.indicator_code,
    })),
    routines,
  };
}

module.exports = { pull };
