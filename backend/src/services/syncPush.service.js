'use strict';

/**
 * POST /sync/push (tarea 8): lote de cambios hechos sin conexión.
 *
 * - Solo el astronauta, con sus datos y desde un dispositivo suyo (403 DEVICE_NOT_OWNED).
 * - Hasta SYNC_MAX_BATCH items (más → 413). Cada item va por el servicio de su tipo
 *   (syncEntities.js) en su propia transacción: uno que falla no tumba el lote.
 * - Orden: priority emergency, luego los críticos (evaluados con sus propios valores, sin
 *   historial) y luego el resto, por measured_at. Una corrección arrastra a su original del
 *   mismo lote para que se procese antes.
 * - Resultado por item: accepted | duplicate | conflict | rejected. Reintentar el lote completo
 *   da todo duplicate (idempotencia por client_uuid del autor).
 * - Conflicto: mismo client_uuid con otro payload (hash SHA-256 del payload canónico, o
 *   comparando con la lectura guardada), o una segunda corrección del mismo original.
 * - Reloj: offset = received_at − sent_at, guardado en sync_batches. measured_at más allá de
 *   SYNC_MAX_FUTURE_SKEW_S en el futuro → rejected FUTURE_TIMESTAMP; nunca se corrige.
 * - Llegada tarde: se evalúa con su measured_at y el escalamiento sale desde la recepción
 *   (compute_deliver_at con cortes). late_sync y lag_s quedan en el resultado y en sync_items.
 */
const crypto = require('node:crypto');
const env = require('../config/env');
const { HttpError, badRequest } = require('../utils/httpError');
const { isUuid } = require('../utils/validate');
const { describeError } = require('../utils/safeLog');
const { evaluateIndicator } = require('../engine/conditions');
const sync = require('../models/sync.model');
const readings = require('../models/readings.model');
const catalog = require('./catalog.service');
const { ruleContext } = require('./evaluation.service');
const { loadActor } = require('./accessPolicy');
const { entityFor } = require('./syncEntities');

const PRIORITIES = ['emergency', 'normal'];
const ENTITY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const STATUSES = ['accepted', 'duplicate', 'conflict', 'rejected'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTimestamp = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

// ---------------------------------------------------------------- utilidades

/** JSON canónico (claves ordenadas, fechas ISO normalizadas) → SHA-256. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && isTimestamp(value)) {
    return new Date(value).toISOString();
  }
  return value;
}

function payloadHash(item) {
  const body = { entity: item.entity, payload: item.payload };
  if (item.supersedes_uuid) body.supersedes_uuid = item.supersedes_uuid;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(body)))
    .digest('hex');
}

const errorBody = (err) => ({ code: err.code, message: err.message, details: err.details ?? null });

/** HttpError del servicio → conflict (409) o rejected (el resto). */
function toFailure(err) {
  if (!(err instanceof HttpError)) {
    console.error(`[sync] item con error inesperado: ${describeError(err)}`);
    return {
      status: 'rejected',
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Error interno al procesar el item.',
        details: null,
      },
    };
  }
  if (err.status === 409) {
    const supersede = err.code === 'CONFLICT' && err.details && err.details.supersedes_uuid;
    return {
      status: 'conflict',
      error: supersede ? { ...errorBody(err), code: 'SUPERSEDE_CONFLICT' } : errorBody(err),
    };
  }
  return { status: 'rejected', error: errorBody(err) };
}

// ---------------------------------------------------------------- lote

async function astronautActor(userId) {
  const actor = await loadActor(userId);
  if (!actor || actor.role !== 'astronaut' || !actor.astronaut_id || !actor.mission_ids.length) {
    throw new HttpError(403, 'NO_ACTIVE_ASSIGNMENT', 'No tienes una asignación de misión vigente.');
  }
  return actor;
}

function checkEnvelope(body) {
  const input = isPlainObject(body) ? body : {};
  const max = env.sync.maxBatch;
  if (Array.isArray(input.items) && input.items.length > max) {
    throw new HttpError(
      413,
      'PAYLOAD_TOO_LARGE',
      `El lote tiene ${input.items.length} items; el máximo es ${max}. Divídelo en lotes más chicos.`,
      { max_items: max, items: input.items.length },
    );
  }
  const problems = [];
  if (
    typeof input.device_id !== 'string' ||
    input.device_id.length < 1 ||
    input.device_id.length > 100
  ) {
    problems.push({ field: 'device_id', issue: 'debe ser texto (1 a 100 caracteres)' });
  }
  if (!isTimestamp(input.sent_at)) {
    problems.push({ field: 'sent_at', issue: 'debe ser una fecha ISO 8601 en UTC' });
  }
  if (!Array.isArray(input.items) || input.items.length < 1) {
    problems.push({ field: 'items', issue: `debe ser una lista de 1 a ${max} items` });
  }
  if (problems.length) throw badRequest(problems);
  return input;
}

/** Valida el sobre de un item. storable = se puede registrar en sync_items. */
function prepare(raw, index) {
  const item = isPlainObject(raw) ? raw : {};
  const problems = [];
  if (!isUuid(item.client_uuid)) problems.push({ field: 'client_uuid', issue: 'debe ser un UUID' });
  if (typeof item.entity !== 'string' || !ENTITY_RE.test(item.entity)) {
    problems.push({ field: 'entity', issue: 'debe ser un tipo de registro (minúsculas y _)' });
  }
  const priority = item.priority === undefined ? 'normal' : item.priority;
  if (!PRIORITIES.includes(priority)) {
    problems.push({ field: 'priority', issue: 'debe ser emergency o normal' });
  }
  if (!isTimestamp(item.created_at)) {
    problems.push({ field: 'created_at', issue: 'debe ser una fecha ISO 8601 en UTC' });
  }
  const storable = !problems.length;
  if (!isPlainObject(item.payload))
    problems.push({ field: 'payload', issue: 'debe ser un objeto' });
  if (item.supersedes_uuid !== undefined && !isUuid(item.supersedes_uuid)) {
    problems.push({ field: 'supersedes_uuid', issue: 'debe ser un UUID' });
  }
  const entry = { index, item: { ...item, priority }, storable };
  if (problems.length) {
    entry.failure = {
      status: 'rejected',
      error: {
        code: 'VALIDATION_ERROR',
        message: 'El item tiene campos inválidos.',
        details: problems.map((p) => ({ ...p, field: `items[${index}].${p.field}` })),
      },
    };
    return entry;
  }
  const { handler, error } = entityFor(item.entity);
  if (error) entry.failure = toFailure(error);
  entry.handler = handler || null;
  const when = handler ? handler.when(item.payload) : undefined;
  entry.measuredAt = isTimestamp(when) ? when : null;
  entry.supersedes = item.payload.supersedes_uuid ?? item.supersedes_uuid ?? null;
  entry.hash = payloadHash(item);
  return entry;
}

/** ¿Es crítico con sus propios valores? (reglas activas, sin derivados ni historial). */
async function provisionalCritical(entry, sex) {
  const { item } = entry;
  if (item.entity !== 'reading' || !isPlainObject(item.payload.values)) return false;
  const found = await catalog.indicatorWithRules(item.payload.indicator_code);
  if (!found || !found.ruleSet || found.indicator.sensitivity !== 'standard') return false;
  const { indicator, ruleSet } = found;
  const evaluation = evaluateIndicator(
    { code: indicator.code, rules: ruleSet.rules, rules_version: ruleSet.version },
    ruleContext({ components: item.payload.values, derived: {}, sex }),
  );
  return evaluation.level === 'critical';
}

/** Orden de proceso: emergency → críticos → resto, por measured_at; originales antes. */
async function plan(entries, sex) {
  const valid = entries.filter((e) => !e.failure);
  for (const e of valid) {
    const emergency = e.item.priority === 'emergency' || e.handler.priority === 'emergency';
    e.rank = emergency ? 0 : (await provisionalCritical(e, sex)) ? 1 : 2;
  }
  const byUuid = new Map(valid.map((e) => [e.item.client_uuid, e]));
  for (const e of valid) {
    const original = e.supersedes && byUuid.get(e.supersedes);
    if (original && original !== e) original.rank = Math.min(original.rank, e.rank);
  }
  const time = (e) => Date.parse(e.measuredAt || e.item.created_at);
  // Entre los de emergencia, primero el tipo (sesión antes que evaluación, respuestas,
  // completar y cerrar): dos tabletas con relojes distintos no los desordenan.
  const order = (e) => (e.rank === 0 ? e.handler.order : 0);
  return valid.sort(
    (a, b) =>
      a.rank - b.rank ||
      order(a) - order(b) ||
      time(a) - time(b) ||
      (a.supersedes ? 1 : 0) - (b.supersedes ? 1 : 0) ||
      a.index - b.index,
  );
}

async function processEntry(entry, { userId, receivedMs }) {
  const { item } = entry;
  if (
    entry.measuredAt &&
    Date.parse(entry.measuredAt) > receivedMs + env.sync.maxFutureSkewS * 1000
  ) {
    return {
      status: 'rejected',
      error: {
        code: 'FUTURE_TIMESTAMP',
        message:
          'measured_at está en el futuro según el reloj del servidor. Revisa la hora del dispositivo; el servidor no la corrige.',
        details: {
          measured_at: entry.measuredAt,
          server_time: new Date(receivedMs).toISOString(),
          max_future_skew_s: env.sync.maxFutureSkewS,
        },
      },
    };
  }
  const prior = await sync.acceptedHash({
    userId,
    entity: item.entity,
    clientUuid: item.client_uuid,
  });
  // Acciones que cambian estado (completar, cerrar, latido): un reintento no se vuelve a ejecutar.
  if (prior && prior.payload_hash === entry.hash && entry.handler.idempotentBySync) {
    return { status: 'duplicate', serverId: prior.server_id };
  }
  if (prior && prior.payload_hash !== entry.hash) {
    return {
      status: 'conflict',
      serverId: prior.server_id,
      error: {
        code: 'PAYLOAD_MISMATCH',
        message:
          'Ya existe un registro con ese client_uuid y otro contenido. Para corregirlo usa supersedes_uuid con un client_uuid nuevo.',
        details: { server_id: prior.server_id },
      },
    };
  }
  try {
    const out = await entry.handler.handle({ userId, item, payload: item.payload });
    return { status: out.status, serverId: out.serverId, result: out.result };
  } catch (err) {
    const failure = toFailure(err);
    const serverId = err.details && err.details.server_id;
    return serverId ? { ...failure, serverId } : failure;
  }
}

/** Resultado del contrato (SyncItemResult) + late_sync / lag_s en `result`. */
function toResult(entry, outcome, receivedMs) {
  const out = {
    client_uuid: isUuid(entry.item.client_uuid) ? entry.item.client_uuid : null,
    entity: typeof entry.item.entity === 'string' ? entry.item.entity : null,
    status: outcome.status,
    server_id: outcome.serverId || null,
  };
  if (entry.sequence) out.sequence = entry.sequence;
  if (outcome.status === 'accepted' || outcome.status === 'duplicate') {
    const lagS = entry.measuredAt
      ? Math.max(0, Math.round((receivedMs - Date.parse(entry.measuredAt)) / 1000))
      : null;
    entry.lagS = lagS;
    entry.late = lagS != null && lagS > env.sync.lateAfterS;
    out.result = { ...(outcome.result || {}), late_sync: entry.late, lag_s: lagS };
  }
  if (outcome.error) out.error = outcome.error;
  return out;
}

async function push({ auth, body }) {
  const startedMs = Date.now();
  const input = checkEnvelope(body);
  const actor = await astronautActor(auth.userId);
  const owned =
    input.device_id === auth.deviceId ||
    (await sync.deviceOwned({
      userId: auth.userId,
      deviceId: input.device_id,
      missionId: actor.mission_ids[0],
    }));
  if (!owned) {
    throw new HttpError(
      403,
      'DEVICE_NOT_OWNED',
      'Ese dispositivo no es tuyo: inicia sesión en él o usa una tableta registrada de tu misión.',
      { device_id: input.device_id },
    );
  }

  const receivedMs = startedMs;
  const clockOffsetMs = receivedMs - Date.parse(input.sent_at);
  const batch = await sync.insertBatch({
    userId: auth.userId,
    deviceId: input.device_id,
    sentAt: input.sent_at,
    itemCount: input.items.length,
    clockOffsetMs,
  });

  const entries = input.items.map(prepare);
  const sex = await readings.astronautSex(actor.astronaut_id);
  const ordered = await plan(entries, sex);
  const results = new Array(entries.length);
  const counts = { accepted: 0, duplicate: 0, conflict: 0, rejected: 0, late: 0 };

  const record = async (entry, outcome) => {
    const result = toResult(entry, outcome, receivedMs);
    results[entry.index] = result;
    counts[result.status] += 1;
    if (entry.late) counts.late += 1;
    if (!entry.storable) return;
    await sync.insertItem({
      batchId: batch.id,
      clientUuid: entry.item.client_uuid,
      entity: entry.item.entity,
      priority: entry.item.priority,
      createdAt: entry.item.created_at,
      status: result.status,
      serverId: result.server_id,
      errorCode: result.error ? result.error.code : null,
      conflictDetail: result.status === 'conflict' ? result.error.details : null,
      payloadHash: entry.hash || null,
      lateSync: entry.late,
      lagS: entry.lagS,
    });
  };

  let sequence = 0;
  for (const entry of ordered) {
    sequence += 1;
    entry.sequence = sequence;
    await record(entry, await processEntry(entry, { userId: auth.userId, receivedMs }));
  }
  for (const entry of entries) if (entry.failure) await record(entry, entry.failure);

  await sync.finishBatch({ id: batch.id, counts, durationMs: Date.now() - startedMs });
  return {
    server_time: new Date().toISOString(),
    batch_id: batch.id,
    clock_offset_s: Math.round(clockOffsetMs / 1000),
    counts: Object.fromEntries(STATUSES.map((s) => [s, counts[s]])),
    results,
  };
}

module.exports = { push, payloadHash, canonical };
