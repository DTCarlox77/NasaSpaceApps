'use strict';
// Matriz de permisos de canAccess: una prueba por celda (actor × recurso).
// canAccess es pura: no necesita base de datos ni .env.
const test = require('node:test');
const assert = require('node:assert/strict');
const { canAccess, fitnessForAdmin } = require('../src/services/accessPolicy');

const M1 = 'mision-1';
const M2 = 'mision-2';

// A1 = el propio astronauta; A2 = otro tripulante de M1; A3 = astronauta de otra misión.
const ACTORS = {
  astronaut: {
    role: 'astronaut',
    astronaut_id: 'A1',
    crew_role: 'flight_engineer',
    mission_ids: [M1],
  },
  commander: { role: 'astronaut', astronaut_id: 'A1', crew_role: 'commander', mission_ids: [M1] },
  cmo: {
    role: 'astronaut',
    astronaut_id: 'A1',
    crew_role: 'crew_medical_officer',
    mission_ids: [M1],
  },
  behavioral_health: { role: 'behavioral_health', mission_ids: [M1] },
  flight_surgeon: { role: 'flight_surgeon', mission_ids: [M1] },
  admin: { role: 'admin', mission_ids: [] },
  service: { role: 'service', mission_ids: [M1] },
};

const std = { sensitivity: 'standard' };
const conf = { sensitivity: 'confidential' };
const RESOURCES = {
  own_physical: {
    astronaut_id: 'A1',
    mission_id: M1,
    ...std,
    category: 'physical',
    action: 'read',
  },
  own_confidential: {
    astronaut_id: 'A1',
    mission_id: M1,
    ...conf,
    category: 'behavioral',
    action: 'read',
  },
  other_physical: {
    astronaut_id: 'A2',
    mission_id: M1,
    ...std,
    category: 'physical',
    action: 'read',
  },
  other_physical_write: {
    astronaut_id: 'A2',
    mission_id: M1,
    ...std,
    category: 'physical',
    action: 'write',
  },
  other_confidential: {
    astronaut_id: 'A2',
    mission_id: M1,
    ...conf,
    category: 'behavioral',
    action: 'read',
  },
  other_confidential_shared: {
    astronaut_id: 'A2',
    mission_id: M1,
    ...conf,
    category: 'behavioral',
    action: 'read',
    share_with_cmo: true,
  },
  escalated_alert: {
    astronaut_id: 'A2',
    mission_id: M1,
    ...std,
    category: 'behavioral',
    action: 'read',
    view: 'escalated_alert',
  },
  compliance: {
    astronaut_id: 'A2',
    mission_id: M1,
    ...std,
    category: 'behavioral',
    action: 'read',
    view: 'compliance',
  },
  fitness: {
    astronaut_id: 'A2',
    mission_id: M1,
    ...std,
    category: 'behavioral',
    action: 'read',
    view: 'fitness',
  },
  emergency_physical: {
    astronaut_id: 'A2',
    mission_id: M1,
    ...std,
    category: 'physical',
    action: 'read',
    emergency_active: true,
  },
  emergency_triage: {
    astronaut_id: 'A2',
    mission_id: M1,
    ...std,
    category: 'emergency',
    action: 'write',
    emergency_active: true,
  },
  emergency_triage_inactive: {
    astronaut_id: 'A2',
    mission_id: M1,
    ...std,
    category: 'emergency',
    action: 'write',
    emergency_active: false,
  },
  emergency_confidential: {
    astronaut_id: 'A2',
    mission_id: M1,
    ...conf,
    category: 'behavioral',
    action: 'read',
    emergency_active: true,
  },
  habitat_read: {
    astronaut_id: null,
    mission_id: M1,
    ...std,
    category: 'physical',
    action: 'read',
  },
  habitat_write: {
    astronaut_id: null,
    mission_id: M1,
    ...std,
    category: 'physical',
    action: 'write',
  },
  other_mission_physical: {
    astronaut_id: 'A3',
    mission_id: M2,
    ...std,
    category: 'physical',
    action: 'read',
  },
  other_mission_confidential: {
    astronaut_id: 'A3',
    mission_id: M2,
    ...conf,
    category: 'behavioral',
    action: 'read',
  },
};

// Esperado por actor, en el orden de RESOURCES (1 = permitido, 0 = denegado).
const COLUMNS = Object.keys(RESOURCES);
// prettier-ignore
const MATRIX = {
  //                  oPh oCf xPh xPw xCf xSh esc cmp fit ePh eTr eTi eCf hRd hWr mPh mCf
  astronaut:         [1,  1,  0,  0,  0,  0,  0,  0,  0,  1,  1,  0,  0,  1,  1,  0,  0],
  commander:         [1,  1,  0,  0,  0,  0,  0,  0,  0,  1,  1,  0,  0,  1,  1,  0,  0],
  cmo:               [1,  1,  1,  0,  0,  1,  0,  0,  0,  1,  1,  0,  0,  1,  1,  0,  0],
  behavioral_health: [0,  1,  0,  0,  1,  1,  1,  1,  1,  0,  0,  0,  1,  0,  0,  0,  0],
  flight_surgeon:    [1,  0,  1,  0,  0,  0,  1,  0,  1,  1,  0,  0,  0,  1,  0,  0,  0],
  admin:             [1,  0,  1,  0,  0,  0,  0,  1,  1,  1,  0,  0,  0,  1,  0,  1,  0],
  service:           [0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  1,  0,  0],
};
// o = propio · x = otro tripulante · m = otra misión · e = emergencia activa · h = hábitat
// Ph/Pw = físico lectura/escritura · Cf = confidencial · Sh = confidencial compartido con el CMO
// esc = alerta escalada · cmp/fit = cumplimiento/aptitud · Tr/Ti = triaje con/sin emergencia activa

for (const [actorName, row] of Object.entries(MATRIX)) {
  assert.equal(row.length, COLUMNS.length, `fila ${actorName} incompleta`);
  row.forEach((expected, i) => {
    const resourceName = COLUMNS[i];
    test(`canAccess: ${actorName} × ${resourceName} → ${expected ? 'permite' : 'niega'}`, () => {
      assert.equal(canAccess(ACTORS[actorName], RESOURCES[resourceName]), Boolean(expected));
    });
  });
}

test('negativos explícitos del encargo', () => {
  assert.equal(
    canAccess(ACTORS.astronaut, RESOURCES.other_confidential),
    false,
    'astronauta lee confidencial ajeno',
  );
  assert.equal(canAccess(ACTORS.admin, RESOURCES.other_confidential), false, 'admin lee bienestar');
  assert.equal(
    canAccess(ACTORS.admin, RESOURCES.escalated_alert),
    false,
    'admin lee alertas de bienestar',
  );
  assert.equal(
    canAccess(ACTORS.flight_surgeon, RESOURCES.other_confidential),
    false,
    'flight surgeon lee detalle conductual',
  );
  for (const r of Object.values(RESOURCES).filter((x) => x.action === 'read')) {
    assert.equal(canAccess(ACTORS.service, r), false, 'service lee algo');
  }
  assert.equal(
    canAccess(ACTORS.cmo, RESOURCES.other_confidential),
    false,
    'CMO lee bienestar sin share_with_cmo',
  );
  assert.equal(
    canAccess(ACTORS.commander, RESOURCES.other_confidential_shared),
    false,
    'comandante lee lo compartido con el CMO',
  );
});

test('flight surgeon: solo lectura de lo físico (responde por mensajes de escalamiento)', () => {
  const fs = ACTORS.flight_surgeon;
  for (const r of Object.values(RESOURCES).filter((x) => x.action === 'write')) {
    assert.equal(canAccess(fs, r), false, `escribe ${JSON.stringify(r)}`);
  }
  assert.equal(canAccess(fs, RESOURCES.other_physical), true);
  assert.equal(canAccess(fs, { ...RESOURCES.emergency_triage, action: 'read' }), true);
});

test('flight surgeon: aptitud sí, cumplimiento no, y solo en su misión', () => {
  const fs = ACTORS.flight_surgeon;
  assert.equal(canAccess(fs, RESOURCES.fitness), true, 'aptitud (fit | not_confirmed)');
  assert.equal(canAccess(fs, RESOURCES.compliance), false, 'cumplimiento es de admin');
  assert.equal(canAccess(fs, { ...RESOURCES.fitness, mission_id: M2 }), false, 'otra misión');
  assert.equal(canAccess(fs, { ...RESOURCES.fitness, ...conf }), false, 'nunca confidencial');
});

test('behavioral_health de otra misión no ve nada', () => {
  const other = { role: 'behavioral_health', mission_ids: [M2] };
  assert.equal(canAccess(other, RESOURCES.other_confidential), false);
  assert.equal(canAccess(other, RESOURCES.other_mission_confidential), true);
});

test('crew_status: toda la tripulación vigente de la misión, en lectura; nadie más', () => {
  const status = (extra = {}) => ({
    astronaut_id: 'A2',
    mission_id: M1,
    ...std,
    category: 'physical',
    action: 'read',
    view: 'crew_status',
    ...extra,
  });
  for (const name of ['astronaut', 'commander', 'cmo']) {
    const actor = ACTORS[name];
    assert.equal(canAccess(actor, status()), true, `${name}: alertas físicas`);
    assert.equal(canAccess(actor, status({ astronaut_id: 'A1' })), true, `${name}: la propia`);
    assert.equal(canAccess(actor, status({ category: 'emergency' })), true, `${name}: emergencia`);
    assert.equal(canAccess(actor, status({ category: 'behavioral' })), false, `${name}: bienestar`);
    assert.equal(canAccess(actor, status({ ...conf })), false, `${name}: confidencial`);
    assert.equal(canAccess(actor, status({ action: 'write' })), false, `${name}: escribe`);
    assert.equal(canAccess(actor, status({ mission_id: M2 })), false, `${name}: otra misión`);
    assert.equal(canAccess(actor, status({ astronaut_id: null })), false, `${name}: hábitat`);
  }
  for (const name of ['admin', 'flight_surgeon', 'behavioral_health', 'service']) {
    assert.equal(canAccess(ACTORS[name], status()), false, `${name} tiene el panel`);
    assert.equal(canAccess(ACTORS[name], status({ category: 'emergency' })), false, name);
  }
  const unassigned = { role: 'astronaut', astronaut_id: 'A1', crew_role: null, mission_ids: [] };
  assert.equal(canAccess(unassigned, status()), false, 'sin asignación vigente');
});

test('crew_physical: solo el oficial médico (CMO); el comandante no', () => {
  const physical = (extra = {}) => ({
    astronaut_id: 'A2',
    mission_id: M1,
    ...std,
    category: 'physical',
    action: 'read',
    view: 'crew_physical',
    ...extra,
  });
  const cmo = ACTORS.cmo;
  assert.equal(canAccess(cmo, physical()), true, 'CMO: otro tripulante');
  assert.equal(canAccess(cmo, physical({ astronaut_id: 'A1' })), true, 'CMO: el propio');
  assert.equal(canAccess(cmo, physical({ ...conf })), false, 'CMO: confidencial');
  assert.equal(canAccess(cmo, physical({ ...conf, share_with_cmo: true })), false, 'compartido');
  assert.equal(canAccess(cmo, physical({ category: 'behavioral' })), false, 'CMO: bienestar');
  assert.equal(canAccess(cmo, physical({ category: 'emergency' })), false, 'CMO: triaje');
  assert.equal(canAccess(cmo, physical({ action: 'write' })), false, 'CMO: escribe');
  assert.equal(canAccess(cmo, physical({ mission_id: M2 })), false, 'CMO: otra misión');
  assert.equal(canAccess(cmo, physical({ indicator_code: 'HEART_RATE' })), true, 'CMO: pulso');
  // SLEEP_HOURS llega con el check-in: diría quién lo hizo y a qué hora (cumplimiento).
  assert.equal(canAccess(cmo, physical({ indicator_code: 'SLEEP_HOURS' })), false, 'CMO: sueño');
  // Tampoco su alerta escalada a bordo (crew_status), para nadie.
  for (const name of ['astronaut', 'commander', 'cmo']) {
    const alert = (code) => physical({ view: 'crew_status', indicator_code: code });
    assert.equal(canAccess(ACTORS[name], alert('SLEEP_HOURS')), false, `${name}: alerta sueño`);
    assert.equal(canAccess(ACTORS[name], alert('HEART_RATE')), true, `${name}: alerta pulso`);
  }
  // El propio tampoco: en esta pantalla su semáforo es solo del CMO (lo suyo está en /me/*).
  for (const name of ['astronaut', 'commander']) {
    assert.equal(canAccess(ACTORS[name], physical()), false, `${name}: otro`);
    assert.equal(canAccess(ACTORS[name], physical({ astronaut_id: 'A1' })), false, `${name}`);
    assert.equal(canAccess(ACTORS[name], physical({ emergency_active: true })), false, name);
  }
  for (const name of ['admin', 'flight_surgeon', 'behavioral_health', 'service']) {
    assert.equal(canAccess(ACTORS[name], physical()), false, `${name} tiene el panel`);
  }
});

test('rol desconocido o actor ausente → niega', () => {
  assert.equal(canAccess({ role: 'crew', mission_ids: [M1] }, RESOURCES.own_physical), false);
  assert.equal(canAccess(null, RESOURCES.own_physical), false);
});

test('un recurso mal formado es un error de programación', () => {
  assert.throws(
    () => canAccess(ACTORS.admin, { ...RESOURCES.own_physical, sensitivity: 'secreta' }),
    TypeError,
  );
  assert.throws(
    () => canAccess(ACTORS.admin, { ...RESOURCES.own_physical, action: 'delete' }),
    TypeError,
  );
  assert.throws(
    () => canAccess(ACTORS.admin, { ...RESOURCES.own_physical, view: 'todo' }),
    TypeError,
  );
  assert.throws(() => canAccess(ACTORS.admin, null), TypeError);
});

test('fitnessForAdmin: solo fit o not_confirmed', () => {
  assert.equal(
    fitnessForAdmin([{ level: 'normal' }, { level: 'normal' }, { level: 'normal' }]),
    'fit',
  );
  assert.equal(fitnessForAdmin([{ level: 'normal' }, { level: 'caution' }]), 'not_confirmed');
  assert.equal(fitnessForAdmin([{ level: 'unrated' }]), 'not_confirmed');
  assert.equal(fitnessForAdmin([]), 'not_confirmed');
  assert.equal(fitnessForAdmin(undefined), 'not_confirmed');
});
