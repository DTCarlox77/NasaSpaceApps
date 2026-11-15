'use strict';

/**
 * Administración de cuentas (rol admin): altas, reset de contraseña y desbloqueo.
 * Contrato: tag Admin-Cuentas de docs/openapi.yaml.
 */
const env = require('../config/env');
const { HttpError, badRequest, notFound, conflict } = require('../utils/httpError');
const { withTransaction } = require('../models/transaction');
const users = require('../models/users.model');
const accounts = require('../models/accounts.model');
const refreshTokens = require('../models/refreshTokens.model');
const authEvents = require('../models/authEvents.model');
const passwords = require('./passwords.service');

const GROUND_ROLES = ['flight_surgeon', 'behavioral_health', 'admin'];
const OPEN_MISSION = ['planned', 'active'];

/** Traduce violaciones de restricciones de la BD a los errores del contrato. */
function mapConstraintError(err, input) {
  if (err instanceof HttpError) return err;
  switch (err.constraint) {
    case 'users_username_uq':
      return conflict('USERNAME_TAKEN', `El usuario ${input.username} ya existe.`, {
        field: 'username',
      });
    case 'users_email_uq':
      return conflict('EMAIL_TAKEN', 'Ese correo ya está registrado.', { field: 'email' });
    case 'astronauts_call_sign_uq':
      return conflict('CALL_SIGN_TAKEN', `El call sign ${input.astronaut.call_sign} ya existe.`, {
        field: 'astronaut.call_sign',
      });
    case 'crew_one_commander_ex':
    case 'crew_one_cmo_ex':
      return conflict('CREW_ROLE_TAKEN', 'La misión ya tiene ese rol de tripulación vigente.', {
        crew_role: input.astronaut.crew_role,
      });
    case 'crew_assignments_no_overlap':
      return conflict(
        'ASSIGNMENT_OVERLAP',
        'El astronauta ya tiene una asignación en ese periodo.',
      );
    case 'users_username_format':
      return badRequest([{ field: 'username', issue: 'formato inválido' }]);
    default:
      if (err.code === '23503') {
        return badRequest([{ field: 'ground_mission_ids', issue: 'alguna misión no existe' }]);
      }
      return err;
  }
}

async function assertOpenMission(missionId, field, db) {
  const mission = await accounts.findMission(missionId, db);
  if (!mission || !OPEN_MISSION.includes(mission.status)) {
    throw badRequest([{ field, issue: 'la misión no existe o ya terminó' }]);
  }
}

/**
 * Crea la cuenta con contraseña temporal (se devuelve UNA sola vez; solo se guarda
 * su hash) y must_change_password = true. Según el rol:
 * - astronaut: perfil + asignación a la misión indicada;
 * - flight_surgeon | behavioral_health | admin: equipo en Tierra de ground_mission_ids
 *   o, si no se indican, de las misiones activas del admin que crea la cuenta;
 * - service: vínculo con su misión (service_accounts).
 */
async function createUser({ actor, input }) {
  const temporaryPassword = passwords.generateTemporary(env.auth.tempPasswordLength);
  const passwordHash = await passwords.hash(temporaryPassword);
  const groundMissionIds = GROUND_ROLES.includes(input.role)
    ? input.ground_mission_ids || (await accounts.activeGroundMissionIds(actor.userId))
    : [];

  try {
    return await withTransaction(async (db) => {
      const user = await users.insertUser(
        {
          username: input.username,
          email: input.email,
          fullName: input.full_name,
          passwordHash,
          role: input.role,
          createdBy: actor.userId,
        },
        db,
      );
      const result = { user };

      if (input.role === 'astronaut') {
        await assertOpenMission(input.astronaut.mission_id, 'astronaut.mission_id', db);
        const astronaut = await accounts.insertAstronaut(
          {
            userId: user.id,
            callSign: input.astronaut.call_sign,
            agency: input.astronaut.agency,
            sex: input.astronaut.sex,
          },
          db,
        );
        const assignment = await accounts.insertAssignment(
          {
            missionId: input.astronaut.mission_id,
            astronautId: astronaut.id,
            crewRole: input.astronaut.crew_role,
            createdBy: actor.userId,
          },
          db,
        );
        result.astronaut = astronaut;
        result.assignment = { ...assignment, call_sign: astronaut.call_sign };
      } else if (input.role === 'service') {
        await assertOpenMission(input.service.mission_id, 'service.mission_id', db);
        await accounts.insertServiceAccount(
          {
            userId: user.id,
            missionId: input.service.mission_id,
            description: input.service.description,
          },
          db,
        );
      } else {
        await accounts.addToGroundTeam(groundMissionIds, user.id, db);
      }

      result.temporary_password = temporaryPassword;
      return result;
    });
  } catch (err) {
    throw mapConstraintError(err, input);
  }
}

/**
 * Sexo biológico del perfil (referencias clínicas). admin lo escribe pero la respuesta no lo
 * incluye: solo lo ven el astronauta y el equipo clínico (accessPolicy, clinical_profile).
 */
async function updateAstronaut({ astronautId, input }) {
  const astronaut = await accounts.updateAstronautSex(astronautId, input.sex);
  if (!astronaut) throw notFound('El astronauta no existe.');
  return astronaut;
}

/** Contraseña temporal nueva, must_change_password y revocación de todas sus sesiones. */
async function resetPassword({ userId, ip }) {
  const temporaryPassword = passwords.generateTemporary(env.auth.tempPasswordLength);
  const passwordHash = await passwords.hash(temporaryPassword);
  return withTransaction(async (db) => {
    const user = await users.setPassword(userId, passwordHash, { mustChange: true }, db);
    if (!user) throw notFound('La cuenta no existe.');
    const revoked = await refreshTokens.revokeForUser(userId, {}, db);
    await authEvents.record({ userId, username: user.username, event: 'password_reset', ip }, db);
    return {
      user_id: userId,
      temporary_password: temporaryPassword,
      must_change_password: true,
      revoked_refresh_tokens: revoked,
    };
  });
}

async function unlock({ userId, ip }) {
  return withTransaction(async (db) => {
    const user = await users.unlock(userId, db);
    if (!user) throw notFound('La cuenta no existe.');
    await authEvents.record({ userId, username: user.username, event: 'account_unlocked', ip }, db);
    return user;
  });
}

module.exports = { createUser, updateAstronaut, resetPassword, unlock };
