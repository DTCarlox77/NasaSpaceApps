'use strict';

/**
 * Reinicio de la demo (tarea 12): deja ARES-1 listo para presentar, con datos SINTÉTICOS, sin
 * borrar nada. Lo usan POST /admin/demo/reset (Render no tiene consola) y
 * `npm run demo:reset` (local). Solo en modo demo (ver env.demoMode y scripts/demoReset.js).
 *
 * Pasos, en este orden:
 * 1. "Pausa" el check-in perdido: marca la historia como cargada AHORA antes de tocar nada.
 *    Si la API dormía (Render) o la historia es de hace días, el barrido de 15 s vería
 *    > TRIAGE_AUTO_MISSED_CHECKIN_H sin check-in y abriría emergencias a mitad del reinicio.
 * 2. Deja listos los usuarios del seed: activos, desbloqueados y con la contraseña del seed;
 *    los que el seed obliga a cambiarla (ATLAS) la siguen teniendo que cambiar. Va antes de la
 *    historia: un astronauta desactivado no saldría en la tripulación vigente.
 * 3. Recarga la historia de `days` días (14) relativa a ahora (idempotente: lo que ya estaba
 *    queda duplicate; agrega los días que falten). Al terminar vuelve a marcar la hora.
 * 4. Cierra (cancelled) las emergencias abiertas, con su evento de línea de tiempo y su reporte,
 *    sin avisar a Tierra (el aviso solo ensuciaría la bandeja que se limpia después).
 * 5. Cierra los cortes de enlace en curso (con el recálculo de deliver_at de lo que esperaba).
 * 6. Cierra los escalamientos abiertos (incluidos los de los escenarios y las pruebas de humo)
 *    y las solicitudes de apoyo abiertas. Va después de las emergencias: una activación que el
 *    barrido hizo justo antes también deja escalamientos. Lo conductual se cierra pero NO se
 *    informa.
 * 7. Aptitud: una PVT en descanso de ahora, con valores de su línea base, para 3 de los 4
 *    astronautas → el panel muestra "apto" en 3 y "no confirmado" en 1 (ATLAS si se puede).
 *
 * No se puede limpiar sin borrar (append-only): lecturas y evaluaciones de los escenarios y de
 * las pruebas de humo, la línea de tiempo de las emergencias, las bitácoras (auth_events,
 * confidential_access_log, delegated_actions) y los lotes de sync. Siguen en el historial.
 */
const env = require('../config/env');
const { pool } = require('../config/db');
const { badRequest, conflict } = require('../utils/httpError');
const { derivedUuid } = require('../utils/derivedUuid');
const { withTransaction } = require('../models/transaction');
const simulatorModel = require('../models/simulator.model');
const emergencyModel = require('../models/emergency.model');
const dashboardModel = require('../models/dashboard.model');
const refreshTokens = require('../models/refreshTokens.model');
const authEvents = require('../models/authEvents.model');
const model = require('../models/demoReset.model');
const P = require('../simulator/profiles');
const simulator = require('./simulator.service');
const emergency = require('./emergency.service');
const C = require('./emergencyCommon');
const missionAdmin = require('./missionAdmin.service');
const passwords = require('./passwords.service');
const recorder = require('./wellbeingRecorder');
const { fitnessByAstronaut } = require('./wellbeing.service');

const MISSION_CODE = simulator.MISSION_CODE; // ARES-1
const LOCK_KEY = 42420012; // un reinicio a la vez
// Contraseña de los usuarios del seed (pública: datos sintéticos de la demo).
const DEMO_PASSWORD = 'Demo2026!';
// Usuarios de los seeds 001 y 003 (ids fijos) y si el seed los obliga a cambiar la contraseña.
const DEMO_USERS = [
  { id: '00000000-0000-4000-8000-000000000001', username: 'mission.control', mustChange: false },
  { id: '00000000-0000-4000-8000-000000000002', username: 'dr.reyes', mustChange: false },
  { id: '00000000-0000-4000-8000-000000000003', username: 'bh.salas', mustChange: false },
  { id: '00000000-0000-4000-8000-000000000004', username: 'svc.habitat', mustChange: false },
  { id: '00000000-0000-4000-8000-000000000011', username: 'a.ortega', mustChange: false },
  { id: '00000000-0000-4000-8000-000000000012', username: 'k.mensah', mustChange: false },
  { id: '00000000-0000-4000-8000-000000000013', username: 'l.tanaka', mustChange: false },
  { id: '00000000-0000-4000-8000-000000000014', username: 'm.silva', mustChange: true },
];
// Quién queda "no confirmado" (sin PVT reciente): el primero de esta lista que no tenga ya una
// PVT apta reciente. ATLAS es el especialista que entra por primera vez en la demo.
const NOT_CONFIRMED_ORDER = ['ATLAS', 'LYRA', 'VEGA', 'ORION'];
const PVT_SLOT = 1; // valor del medio de los 3 de la línea base (z ≈ 0)
const CLOSE_NOTES = 'Reinicio de demo (datos sintéticos): cerrada sin atención.';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Confirmación obligatoria ({ confirm: "ARES-1" }) y los parámetros de la historia. */
function resetParams(body) {
  const input = isPlainObject(body) ? body : {};
  if (input.confirm !== MISSION_CODE) {
    throw badRequest(
      [{ field: 'confirm', issue: `escribe "${MISSION_CODE}" para confirmar el reinicio` }],
      'Falta la confirmación del reinicio de demo.',
    );
  }
  return simulator.historyParams({ days: input.days, seed: input.seed });
}

// ---------------------------------------------------------------- pasos

async function closeEmergencies(missionId, actorUserId) {
  let closed = 0;
  for (const id of await model.openSessionIds(missionId)) {
    const done = await withTransaction(async (db) => {
      const ok = await emergencyModel.closeSession(
        {
          id,
          status: 'cancelled',
          closedAt: new Date().toISOString(),
          closedBy: actorUserId,
          notes: CLOSE_NOTES,
        },
        db,
      );
      if (!ok) return false;
      const session = await emergencyModel.findSession(id, db);
      await C.event(
        session,
        'closed',
        { actorUserId, details: { status: 'cancelled', reason: 'demo_reset' } },
        db,
      );
      await emergencyModel.insertReport(id, await emergency.buildReport(id, db), db);
      return true;
    });
    if (done) closed += 1;
  }
  return closed;
}

async function closeOutages(missionId) {
  const { open, scheduled } = await model.outages(missionId);
  for (const outage of open) {
    // Termina ahora (o 1 s después de empezar, si acaba de empezar: ends_at > starts_at).
    const endsAt = Math.max(Date.now(), new Date(outage.starts_at).getTime() + 1000);
    await missionAdmin.updateOutage({
      id: outage.id,
      body: { ends_at: new Date(endsAt).toISOString() },
    });
  }
  return { closed: open.length, scheduled_left: scheduled };
}

/** Usuarios del seed listos para la demo. Devuelve qué cambió de cada uno (sin secretos). */
async function readyUsers(ip) {
  const rows = new Map((await model.usersByIds(DEMO_USERS.map((u) => u.id))).map((r) => [r.id, r]));
  const out = [];
  for (const seedUser of DEMO_USERS) {
    const row = rows.get(seedUser.id);
    if (!row) {
      out.push({ username: seedUser.username, missing: true });
      continue;
    }
    const passwordOk = await passwords.compare(DEMO_PASSWORD, row.password_hash);
    const passwordHash = passwordOk ? null : await passwords.hash(DEMO_PASSWORD);
    await withTransaction(async (db) => {
      await model.readyUser(row.id, db);
      if (row.locked) {
        await authEvents.record(
          { userId: row.id, username: row.username, event: 'account_unlocked', ip },
          db,
        );
      }
      if (!passwordOk) {
        await model.restorePassword(
          { id: row.id, passwordHash, mustChange: seedUser.mustChange },
          db,
        );
        await refreshTokens.revokeForUser(row.id, {}, db);
        await authEvents.record(
          { userId: row.id, username: row.username, event: 'password_reset', ip },
          db,
        );
      } else if (row.must_change_password !== seedUser.mustChange) {
        await model.setMustChange(row.id, seedUser.mustChange, db);
      }
    });
    out.push({
      username: seedUser.username,
      unlocked: Boolean(row.locked),
      reactivated: !row.is_active,
      password_restored: !passwordOk,
      must_change_password: seedUser.mustChange,
    });
  }
  return out;
}

/**
 * Aptitud: PVT en descanso de ahora para todos menos uno (el primero de NOT_CONFIRMED_ORDER sin
 * PVT apta reciente). Si los 4 ya tienen una PVT apta reciente (de la historia o de una prueba),
 * no se puede dejar uno sin confirmar sin borrar: se informa.
 */
async function recordFitness(crew, now) {
  const ids = crew.map((m) => m.astronaut_id);
  const before = await fitnessByAstronaut(ids, now.getTime());
  const byCallSign = new Map(crew.map((m) => [m.call_sign, m]));
  const candidates = [
    ...NOT_CONFIRMED_ORDER.filter((cs) => byCallSign.has(cs)),
    ...crew.map((m) => m.call_sign).filter((cs) => !NOT_CONFIRMED_ORDER.includes(cs)),
  ];
  const left = candidates.find((cs) => before.get(byCallSign.get(cs).astronaut_id) !== 'fit');
  const minute = new Date(now.getTime() - (now.getTime() % 60000)).toISOString();
  const measuredAt = new Date(now.getTime() - 5000).toISOString();
  const problems = [];
  for (const member of crew) {
    if (member.call_sign === left) continue;
    const pvt = P.profileFor(member.call_sign).pvt;
    const id = (...parts) => derivedUuid('demo-reset', 'pvt', member.call_sign, minute, ...parts);
    const result = await recorder.recordPvtRun({
      userId: member.user_id,
      run: {
        client_uuid: id('run'),
        device_id: P.PVT_DEVICE,
        before_critical_task: false,
        duration_s: 180,
        trials: 52,
        measured_at: measuredAt,
        readings: [
          { indicator_code: 'PVT_LAPSES', value: pvt.lapses[PVT_SLOT], client_uuid: id('L') },
          { indicator_code: 'PVT_MEAN_RT', value: pvt.mean_rt[PVT_SLOT], client_uuid: id('RT') },
          {
            indicator_code: 'PVT_FALSE_STARTS',
            value: pvt.false_starts[PVT_SLOT],
            client_uuid: id('FS'),
          },
        ],
      },
    });
    if (result.status === 'accepted' && result.fitness !== 'fit') problems.push(member.call_sign);
  }
  const after = await fitnessByAstronaut(ids, Date.now());
  const fitness = Object.fromEntries(
    crew.map((m) => [m.call_sign, after.get(m.astronaut_id) || 'not_confirmed']),
  );
  const notes = [];
  if (!left) {
    notes.push(
      'Los 4 astronautas ya tenían una PVT apta reciente: no se puede dejar uno sin confirmar ' +
        `sin borrar (vuelve a intentarlo en ${env.wellbeing.fitnessMaxAgeH} h).`,
    );
  }
  if (problems.length) {
    notes.push(`La PVT de ${problems.join(', ')} no quedó apta (revisa su línea base).`);
  }
  return { fitness, not_confirmed: left || null, notes };
}

/**
 * Indicadores físicos cuya última lectura vigente (la que muestra el panel) está en caution o
 * critical: la historia normal deja alguna precaución de autocuidado; un critical suele ser de
 * un escenario anterior y no se puede quitar sin borrar.
 */
async function panelFlags(missionId, crew) {
  const callSign = new Map(crew.map((m) => [m.astronaut_id, m.call_sign]));
  const rows = await dashboardModel.recentPhysicalReadings({
    missionId,
    astronautIds: crew.map((m) => m.astronaut_id),
    perIndicator: 1,
  });
  return rows
    .filter((r) => ['caution', 'critical'].includes(r.level))
    .map((r) => ({
      call_sign: callSign.get(r.astronaut_id),
      indicator_code: r.indicator_code,
      level: r.level,
      measured_at: new Date(r.measured_at).toISOString(),
    }))
    .sort((a, b) => (a.level === b.level ? 0 : a.level === 'critical' ? -1 : 1));
}

// ---------------------------------------------------------------- API

async function run({ days, seed, actorUserId, ip }) {
  const startedAt = new Date();
  const mission = await simulatorModel.missionByCode(MISSION_CODE);
  if (!mission) {
    throw conflict('CONFLICT', `No existe la misión ${MISSION_CODE}: corre el seed de demo.`);
  }
  // 1. Antes que nada: el check-in perdido cuenta desde ahora.
  await emergency.markHistoryLoaded(startedAt);
  // 2. Usuarios del seed.
  const users = await readyUsers(ip);
  // 3. Historia relativa a ahora (marca la hora otra vez al terminar).
  const history = await simulator.loadHistory({ body: { days, seed } });
  // 4–6. Emergencias, cortes, escalamientos y solicitudes de apoyo.
  const emergencies = await closeEmergencies(mission.id, actorUserId);
  const outages = await closeOutages(mission.id);
  const escalations = await model.closeEscalations(mission.id, actorUserId);
  await model.closeSupportRequests(mission.id, actorUserId);
  // 7. Aptitud (después de la historia: puede haber traído la PVT semanal de hoy).
  const crew = await simulatorModel.currentCrew(mission.id);
  const fitness = await recordFitness(crew, new Date());
  const flagged = await panelFlags(mission.id, crew);

  return {
    mission_code: MISSION_CODE,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    history: {
      days,
      seed,
      from: history.from,
      to: history.to,
      readings: history.readings,
      errors: history.errors,
    },
    emergencies: { closed: emergencies },
    comm_outages: outages,
    // Solo físicos y de emergencia: lo conductual también se cierra, pero no se cuenta.
    escalations: { closed: escalations.visible },
    users,
    fitness: fitness.fitness,
    not_confirmed: fitness.not_confirmed,
    // Lo que el panel seguirá marcando (última lectura física vigente en caution o critical).
    panel_flags: flagged,
    triage: {
      missed_checkin_counts_from: (
        await emergencyModel.getMarker(emergency.HISTORY_MARKER)
      ).toISOString(),
      missed_checkin_after_h: env.triage.autoMissedCheckinH,
    },
    notes: [
      'Lo conductual (escalamientos a behavioral_health y solicitudes de apoyo) también quedó ' +
        'cerrado; no se cuenta porque solo lo ve behavioral_health.',
      'Nada se borró: las lecturas, evaluaciones, líneas de tiempo y bitácoras son append-only, ' +
        'así que lo de los escenarios y las pruebas de humo sigue en el historial.',
      ...(flagged.some((f) => f.level === 'critical')
        ? [
            'panel_flags tiene lecturas critical vigentes (p. ej. de un escenario anterior): el ' +
              'panel las sigue mostrando hasta que llegue una lectura más nueva del mismo ' +
              'indicador. Sin borrar no se pueden quitar.',
          ]
        : []),
      ...fitness.notes,
    ],
  };
}

/**
 * Reinicio de demo. body = { confirm: "ARES-1", days?, seed? }. actorUserId: el admin del
 * endpoint (null desde la terminal). Un reinicio a la vez (409 si ya hay uno).
 */
async function resetDemo({ body, actorUserId = null, ip = null } = {}) {
  const { days, seed } = resetParams(body);
  const lock = await pool.connect();
  try {
    const { rows } = await lock.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!rows[0].ok) {
      throw conflict(
        'DEMO_RESET_RUNNING',
        'Ya hay un reinicio de demo en curso: espera a que termine.',
      );
    }
    try {
      return await run({ days, seed, actorUserId, ip });
    } finally {
      await lock.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    }
  } finally {
    lock.release();
  }
}

module.exports = { resetDemo, resetParams, DEMO_USERS, NOT_CONFIRMED_ORDER, MISSION_CODE };
