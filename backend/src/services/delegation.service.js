'use strict';

/**
 * Permisos delegados del comandante (tarea 11): resolver problemas de ACCESO a bordo cuando
 * Tierra no responde a tiempo. Solo sobre los tripulantes de SU misión vigente.
 *
 * Mapa de capacidades (en código, no en la base): el comandante puede
 *   - unlock_user:       desbloquear la cuenta de un tripulante (bloqueo por intentos);
 *   - reset_offline_pin: borrar el PIN offline de un tripulante (define otro en su próximo login);
 *   - register_device:   registrar una tableta de repuesto (credencial mostrada una sola vez).
 * Nada más: ninguna capacidad da acceso a datos médicos ni de bienestar (accessPolicy no cambia:
 * para canAccess el comandante es un astronauta más).
 *
 * Cada uso queda en delegated_actions (append-only) y en auth_events, y se reporta a Tierra:
 * deliver_at = compute_deliver_at(misión, recepción), derivado al leer (cortes incluidos).
 */
const { badRequest, forbidden, notFound } = require('../utils/httpError');
const { isUuid, uuidParam } = require('../utils/validate');
const {
  decodeCursor,
  limitIssue,
  parseLimit,
  toPage,
  isTimestampText,
} = require('../utils/pagination');
const { withTransaction } = require('../models/transaction');
const delegated = require('../models/delegated.model');
const users = require('../models/users.model');
const authEvents = require('../models/authEvents.model');
const devicesService = require('./devices.service');
const { loadActor } = require('./accessPolicy');
const { resolveMission } = require('./missionScope');

const COMMANDER_CAPABILITIES = Object.freeze({
  unlock_user: { targetType: 'user', authEvent: 'delegated_unlock' },
  reset_offline_pin: { targetType: 'user', authEvent: 'pin_reset' },
  register_device: { targetType: 'device', authEvent: 'device_registered' },
});

/** ¿Este rol de tripulación puede usar la capacidad? (pura) */
const can = (crewRole, action) =>
  crewRole === 'commander' && Object.hasOwn(COMMANDER_CAPABILITIES, action);

/** El comandante vigente (requireCrewRole ya lo verificó con v_current_crew). */
async function commanderActor(userId, action) {
  const actor = await loadActor(userId);
  if (!actor || actor.role !== 'astronaut' || !actor.mission_ids.length) throw forbidden();
  if (!can(actor.crew_role, action)) {
    throw forbidden(
      { required_crew_roles: ['commander'] },
      'Esta acción requiere ser el comandante de la misión.',
    );
  }
  return actor;
}

/** Tripulante vigente de la misión del comandante; si no, 404 (no revela otras misiones). */
async function targetCrew(actor, id, db) {
  const member = await delegated.crewMember(
    { userId: uuidParam(id), missionId: actor.mission_ids[0] },
    db,
  );
  if (!member) throw notFound('No es un tripulante de tu misión.');
  return member;
}

const audit = (row) => ({
  audit_id: row.id,
  reported_to_earth: row.deliver_at !== null,
  deliver_at: row.deliver_at,
});

async function record(actor, { action, targetId, details }, db) {
  return delegated.insert(
    {
      missionId: actor.mission_ids[0],
      actorUserId: actor.user_id,
      action,
      targetType: COMMANDER_CAPABILITIES[action].targetType,
      targetId,
      details,
      performedAt: new Date().toISOString(),
    },
    db,
  );
}

/** POST /crew/users/{id}/unlock */
async function unlockUser({ userId, id, deviceId, ip }) {
  const actor = await commanderActor(userId, 'unlock_user');
  return withTransaction(async (db) => {
    const target = await targetCrew(actor, id, db);
    const before = await users.findById(target.user_id, db);
    await users.unlock(target.user_id, db);
    await authEvents.record(
      {
        userId: target.user_id,
        username: target.username,
        event: 'delegated_unlock',
        deviceId,
        ip,
      },
      db,
    );
    const row = await record(
      actor,
      {
        action: 'unlock_user',
        targetId: target.user_id,
        details: { was_locked: before.is_locked },
      },
      db,
    );
    return {
      action: 'unlock_user',
      target_user_id: target.user_id,
      performed_at: row.performed_at,
      audit: audit(row),
    };
  });
}

/** POST /crew/users/{id}/reset-pin: el PIN anterior deja de servir en todos sus dispositivos. */
async function resetPin({ userId, id, deviceId, ip }) {
  const actor = await commanderActor(userId, 'reset_offline_pin');
  return withTransaction(async (db) => {
    const target = await targetCrew(actor, id, db);
    const count = await delegated.resetPins({ userId: target.user_id, resetBy: actor.user_id }, db);
    await authEvents.record(
      { userId: target.user_id, username: target.username, event: 'pin_reset', deviceId, ip },
      db,
    );
    const row = await record(
      actor,
      { action: 'reset_offline_pin', targetId: target.user_id, details: { pins_reset: count } },
      db,
    );
    return {
      action: 'reset_offline_pin',
      target_user_id: target.user_id,
      performed_at: row.performed_at,
      audit: audit(row),
    };
  });
}

/** POST /crew/devices: tableta de repuesto en la misión del comandante. */
async function registerDevice({ userId, body, ip }) {
  const actor = await commanderActor(userId, 'register_device');
  const input = devicesService.validateDeviceBody(body, { withMission: false });
  return withTransaction(async (db) => {
    const created = await devicesService.register(
      {
        missionId: actor.mission_ids[0],
        label: input.label,
        moduleId: input.module_id,
        actor,
        via: 'commander',
        ip,
      },
      db,
    );
    const row = await record(
      actor,
      { action: 'register_device', targetId: created.device.id, details: { label: input.label } },
      db,
    );
    return { ...created, audit: audit(row) };
  });
}

// ---------------------------------------------------------------- auditoría (Tierra)

function toItem(row) {
  return {
    id: row.id,
    mission_id: row.mission_id,
    actor_user_id: row.actor_user_id,
    actor_call_sign: row.actor_call_sign,
    crew_role: row.crew_role,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    performed_at: row.performed_at,
    received_at: row.received_at,
    deliver_at: row.deliver_at,
  };
}

/** GET /admin/audit/delegated-actions: solo lo que ya llegó a Tierra. */
async function groundAudit({ userId, query }) {
  const problems = [];
  for (const field of ['from', 'to']) {
    if (query[field] !== undefined && Number.isNaN(Date.parse(query[field]))) {
      problems.push({ field, issue: 'debe ser una fecha ISO 8601' });
    }
  }
  const issue = limitIssue(query.limit);
  if (issue) problems.push({ field: 'limit', issue });
  if (problems.length) throw badRequest(problems);
  const limit = parseLimit(query.limit);
  const after = decodeCursor(query.cursor, (c) => isTimestampText(c.p) && isUuid(c.id));
  const actor = await loadActor(userId);
  if (!actor || actor.role !== 'admin') throw forbidden();
  const mission = await resolveMission(actor, query.mission_id);
  const rows = await delegated.groundPage({
    missionId: mission.id,
    from: query.from ? new Date(query.from).toISOString() : null,
    to: query.to ? new Date(query.to).toISOString() : null,
    after,
    limit,
  });
  return toPage(rows, limit, (r) => ({ p: r.performed_at_text, id: r.id }), toItem);
}

module.exports = {
  COMMANDER_CAPABILITIES,
  can,
  unlockUser,
  resetPin,
  registerDevice,
  groundAudit,
};
