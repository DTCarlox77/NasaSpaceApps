'use strict';

const accountsService = require('../services/accounts.service');
const { validate, uuidParam } = require('../utils/validate');

const SEXES = ['female', 'male'];
const ROLES = ['astronaut', 'flight_surgeon', 'behavioral_health', 'admin', 'service'];
const CREW_ROLES = [
  'commander',
  'pilot',
  'crew_medical_officer',
  'flight_engineer',
  'mission_specialist',
];

function validateCreate(body) {
  const v = validate(body)
    .string('username', {
      min: 3,
      max: 40,
      pattern: /^[a-z0-9._-]{3,40}$/,
      patternIssue: 'solo minúsculas, números, punto, guion y guion bajo',
    })
    .string('full_name', { max: 120 })
    .email('email')
    .oneOf('role', ROLES);
  const role = v.get('role');

  if (role === 'astronaut') {
    v.string('astronaut.call_sign', { min: 2, max: 20 })
      .string('astronaut.agency', { required: false, max: 80 })
      .uuid('astronaut.mission_id')
      .oneOf('astronaut.crew_role', CREW_ROLES)
      .oneOf('astronaut.sex', SEXES, { required: false });
  } else if (v.get('astronaut') !== undefined) {
    v.add('astronaut', 'solo aplica a role = astronaut');
  }
  if (role === 'service') {
    v.uuid('service.mission_id').string('service.description', { max: 200 });
  } else if (v.get('service') !== undefined) {
    v.add('service', 'solo aplica a role = service');
  }
  if (role === 'astronaut' || role === 'service') {
    if (v.get('ground_mission_ids') !== undefined) {
      v.add('ground_mission_ids', 'no aplica a astronautas ni a cuentas de servicio');
    }
  } else {
    v.uuidArray('ground_mission_ids');
  }
  return v.check();
}

async function create(req, res) {
  const input = validateCreate(req.body);
  res.status(201).json(await accountsService.createUser({ actor: req.auth, input }));
}

/** PATCH /admin/astronauts/{id}: { sex: female | male | null } (null lo borra). */
function validateAstronautPatch(body) {
  const v = validate(body);
  const input = v.body;
  const keys = Object.keys(input);
  if (!keys.length) v.add('sex', 'es obligatorio');
  for (const key of keys) if (key !== 'sex') v.add(key, 'no se puede modificar aquí');
  if (input.sex !== null) v.oneOf('sex', SEXES, { required: keys.length > 0 });
  return v.check();
}

async function updateAstronaut(req, res) {
  const astronautId = uuidParam(req.params.id);
  const input = validateAstronautPatch(req.body);
  res.json(await accountsService.updateAstronaut({ astronautId, input }));
}

async function resetPassword(req, res) {
  const userId = uuidParam(req.params.id);
  res.json(await accountsService.resetPassword({ userId, ip: req.ip }));
}

async function unlock(req, res) {
  const userId = uuidParam(req.params.id);
  res.json(await accountsService.unlock({ userId, ip: req.ip }));
}

module.exports = { create, updateAstronaut, resetPassword, unlock };
