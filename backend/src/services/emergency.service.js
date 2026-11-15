'use strict';

/**
 * Modo emergencia (tarea 9): activación, interruptor de hombre muerto, latido, cierre,
 * preguntas a Tierra y la vista de la sesión a bordo.
 *
 * - Una sola sesión abierta (pending | active) por misión. Una segunda activación (botón,
 *   automática o una sesión creada sin conexión que llega por sync) se UNE a la abierta:
 *   queda como fila merged (merged_into) y en la línea de tiempo. Nunca se descarta nada.
 * - Activación automática (lectura crítica, check-in perdido): la sesión nace pending y el
 *   tripulante afectado tiene TRIAGE_DEADMAN_S para responder "estoy bien". Si confirma, se
 *   cancela; si no, sweepDeadman la activa, avisa a la tripulación y escala a Tierra.
 * - El botón manual (o un aviso de un tripulante) la abre activa de una vez.
 * - No diagnostica ni receta: lo que no cubre el protocolo va a Tierra como pregunta.
 * - El triaje no usa datos de bienestar (solo la HORA del último check-in para detectar uno
 *   perdido; nunca sus valores).
 */
const env = require('../config/env');
const { HttpError, badRequest, conflict, notFound } = require('../utils/httpError');
const { isUuid } = require('../utils/validate');
const { derivedUuid } = require('../utils/derivedUuid');
const { withTransaction } = require('../models/transaction');
const model = require('../models/emergency.model');
const { measuredAtIssue } = require('./readingValidation');
const view = require('./triageView');
const C = require('./emergencyCommon');

const TRIGGERS = [
  'manual_button',
  'crew_event',
  'critical_reading',
  'missed_checkin',
  'environment_alarm',
];
const AUTO_TRIGGERS = ['critical_reading', 'missed_checkin'];
const HISTORY_MARKER = 'simulator_history_loaded_at';
const RISK_WINDOW_MIN = 60; // lectura crítica "reciente" para el roster (regla de diseño)

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function timestampIssue(value) {
  return measuredAtIssue(value);
}

// ---------------------------------------------------------------- vista a bordo

/** Riesgos conocidos por tripulante (para el roster y el orden de atención). */
async function risksFor(session, deadman) {
  const risks = new Map();
  for (const d of deadman) {
    if (d.expired_at) {
      risks.set(d.astronaut_id, { reason: 'No respondió "estoy bien" a tiempo', rank: 0 });
    } else if (!d.confirmed_at) {
      risks.set(d.astronaut_id, {
        reason:
          d.trigger_type === 'missed_checkin'
            ? 'Sin respuesta a la alerta de check-in'
            : 'Esperando "estoy bien"',
        rank: 1,
      });
    }
  }
  for (const r of await model.recentCritical(session.mission_id, RISK_WINDOW_MIN)) {
    if (risks.has(r.astronaut_id)) continue;
    const minutes = Math.max(0, Math.round((Date.now() - new Date(r.measured_at)) / 60000));
    risks.set(r.astronaut_id, {
      reason: `Lectura crítica de ${r.indicator_code} hace ${minutes} min`,
      rank: 2,
    });
  }
  return risks;
}

/** Prellenado: respuestas sugeridas desde lecturas recientes (reglas del protocolo). */
async function prefillFor(crew, protocol) {
  const out = new Map();
  const questions = view.prefillQuestions(protocol.definition);
  for (const member of crew) {
    const entries = {};
    for (const q of questions) {
      const reading = await model.latestReading({
        astronautId: member.astronaut_id,
        indicatorCode: q.prefill.indicator,
        maxAgeMinutes: q.prefill.max_age_minutes || 10,
      });
      if (!reading) continue;
      const value = view.applyPrefillRule(q.prefill.rule, reading.components);
      if (value === null || value === undefined) continue;
      entries[q.code] = { value, source_reading_id: reading.id, measured_at: reading.measured_at };
    }
    out.set(member.astronaut_id, entries);
  }
  return out;
}

/**
 * Sesión + roster + orden de atención + evaluaciones. `ground` = la vista de Tierra (solo
 * lo que ya llegó); admin solo recibe el estado operativo.
 */
async function sessionView(session, actor, { ground = false } = {}) {
  const [protocol, deadman, merged, crew, allAssessments] = await Promise.all([
    model.protocolById(session.protocol_id),
    model.deadmanFor(session.id),
    model.mergedInto(session.id),
    model.crewOfMission(session.mission_id),
    model.assessmentsFor(session.id),
  ]);
  let assessments = allAssessments;
  if (ground) {
    const delivered = await model.eventsFor(session.id, { delivered: true });
    const done = new Set(
      delivered.filter((e) => e.event_type === 'assessment_completed').map((e) => e.assessment_id),
    );
    const started = new Set(
      delivered.filter((e) => e.event_type === 'assessment_started').map((e) => e.assessment_id),
    );
    // Lo que todavía no llegó a Tierra no se ve; una completada que no llegó, en curso.
    assessments = allAssessments
      .filter((a) => started.has(a.id) || done.has(a.id))
      .map((a) => (done.has(a.id) ? a : { ...a, status: 'in_progress', completed_at: null }));
  }
  const clinical = C.seesClinical(actor);
  const definition = protocol.definition;
  const risks = clinical ? await risksFor(session, deadman) : new Map();
  const prefill = !ground && clinical ? await prefillFor(crew, protocol) : new Map();
  const out = {
    session: C.toSession(session, { deadman, merged, protocol }),
    roster: view
      .roster({ crew, risks, prefill })
      .map((entry) => (clinical ? entry : { ...entry, priority_reason: null, prefill: {} })),
    assessments: assessments.map((a) => C.toAssessment(a, { clinical })),
  };
  if (clinical) {
    out.attention_order = view.attentionOrder({ crew, assessments, protocol: definition, risks });
  } else {
    out.session.context = {};
    out.session.deadman = out.session.deadman.map(({ astronaut_id, call_sign, status }) => ({
      astronaut_id,
      call_sign,
      status,
    }));
  }
  return out;
}

// ---------------------------------------------------------------- activación

function checkSessionInput(input) {
  const body = isPlainObject(input) ? input : {};
  const problems = [];
  if (!isUuid(body.client_uuid)) problems.push({ field: 'client_uuid', issue: 'debe ser un UUID' });
  if (!TRIGGERS.includes(body.trigger_type)) {
    problems.push({ field: 'trigger_type', issue: `debe ser uno de: ${TRIGGERS.join(', ')}` });
  }
  const whenIssue = timestampIssue(body.started_at);
  if (whenIssue) problems.push({ field: 'started_at', issue: whenIssue });
  if (body.context !== undefined && body.context !== null && !isPlainObject(body.context)) {
    problems.push({ field: 'context', issue: 'debe ser un objeto' });
  }
  const safe = body.responder_safe;
  if (
    safe !== undefined &&
    safe !== null &&
    !(isPlainObject(safe) && typeof safe.value === 'boolean')
  ) {
    problems.push({ field: 'responder_safe', issue: 'debe ser { "value": true | false }' });
  }
  if (problems.length) throw badRequest(problems);
  return body;
}

const isUniqueOpen = (err) => err && err.constraint === 'emergency_one_open_per_mission_uq';

/**
 * Activación manual (POST /emergency/sessions o emergency_session por sync). Si ya hay una
 * sesión abierta en la misión, se une a ella (fila merged + evento joined) y responde la
 * abierta con joined: true.
 */
async function createSession({ actor, input }) {
  const body = checkSessionInput(input);
  const missionId = C.crewMission(actor);
  const existing = await model.findSessionByClientUuid(body.client_uuid);
  if (existing) {
    if (existing.mission_id !== missionId) {
      throw conflict('CONFLICT', 'Ese client_uuid ya se usó en otra misión.');
    }
    const primary = await C.resolveSession(existing.id);
    return {
      status: 200,
      body: { ...(await sessionView(primary, actor)), joined: Boolean(existing.merged_into) },
    };
  }
  const protocol = await model.activeProtocol();
  if (!protocol) throw new HttpError(503, 'NO_PROTOCOL', 'No hay protocolo de triaje activo.');
  const responderSafe = body.responder_safe ? body.responder_safe.value : null;

  const attempt = () =>
    withTransaction(async (db) => {
      const open = await model.openSession(missionId, db, { lock: true });
      if (open) {
        await model.insertSession(
          {
            clientUuid: body.client_uuid,
            missionId,
            protocolId: open.protocol_id,
            triggerType: body.trigger_type,
            startedBy: C.actorUserId(actor),
            status: 'merged',
            context: body.context || {},
            startedAt: body.started_at,
            closedAt: new Date().toISOString(),
            responderSafe,
            mergedInto: open.id,
          },
          db,
        );
        await C.event(
          open,
          'joined',
          {
            actorUserId: C.actorUserId(actor),
            actorDevice: C.actorDevice(actor),
            clientUuid: derivedUuid('emergency-event', body.client_uuid, 'joined'),
            details: { trigger_type: body.trigger_type, client_uuid: body.client_uuid },
            deviceAt: body.started_at,
          },
          db,
        );
        if (responderSafe !== null) await model.setResponderSafe(open.id, responderSafe, db);
        // Alguien apretó el botón: una sesión que esperaba "estoy bien" pasa a activa.
        if (open.status === 'pending' && (await model.activateSession(open.id, db))) {
          await C.event(open, 'activated', { details: { reason: 'manual_join' } }, db);
          await C.escalateActivation(open, 'un tripulante la activó a mano', db);
        }
        return { id: open.id, joined: true };
      }
      const { id } = await model.insertSession(
        {
          clientUuid: body.client_uuid,
          missionId,
          protocolId: protocol.id,
          triggerType: body.trigger_type,
          startedBy: C.actorUserId(actor),
          status: 'active',
          context: body.context || {},
          startedAt: body.started_at,
          responderSafe,
          activatedAt: new Date().toISOString(),
        },
        db,
      );
      const session = await model.findSession(id, db);
      await C.event(
        session,
        'opened',
        {
          actorUserId: C.actorUserId(actor),
          actorDevice: C.actorDevice(actor),
          details: { trigger_type: body.trigger_type, automatic: false },
          deviceAt: body.started_at,
        },
        db,
      );
      await C.escalateActivation(session, null, db);
      return { id, joined: false };
    });

  let outcome;
  try {
    outcome = await attempt();
  } catch (err) {
    if (!isUniqueOpen(err)) throw err;
    outcome = await attempt(); // otra activación ganó la carrera: ahora se une
  }
  const session = await model.findSession(outcome.id);
  return { status: 201, body: { ...(await sessionView(session, actor)), joined: outcome.joined } };
}

/**
 * Activación automática (lectura crítica o check-in perdido) del tripulante `astronautId`.
 * Abre una sesión pending (o se une a la abierta) con su plazo de "estoy bien". Idempotente
 * por `key` (la lectura o el último check-in). Devuelve { session_id, status, deadline_at }.
 */
async function activateAutomatic({
  missionId,
  astronautId,
  triggerType,
  key,
  readingId,
  details = {},
  now = new Date(),
}) {
  if (!env.triage.autoEnabled || !AUTO_TRIGGERS.includes(triggerType)) return null;
  const protocol = await model.activeProtocol();
  if (!protocol) return null;
  const deadlineAt = new Date(new Date(now).getTime() + env.triage.deadmanSeconds * 1000);
  const clientUuid = derivedUuid('emergency-auto', missionId, triggerType, key);

  const attempt = () =>
    withTransaction(async (db) => {
      let session = await model.openSession(missionId, db, { lock: true });
      if (session) {
        await C.event(
          session,
          'joined',
          {
            astronautId,
            clientUuid: derivedUuid('emergency-event', clientUuid, 'joined'),
            details: { trigger_type: triggerType, automatic: true, ...details },
          },
          db,
        );
      } else {
        const existing = await model.findSessionByClientUuid(clientUuid, db);
        if (existing) return { id: existing.id }; // ya se activó por esta misma causa
        const { id } = await model.insertSession(
          {
            clientUuid,
            missionId,
            protocolId: protocol.id,
            triggerType,
            status: 'pending',
            context: await model.autoContext(missionId, db),
            startedAt: new Date(now).toISOString(),
          },
          db,
        );
        session = await model.findSession(id, db);
        await C.event(
          session,
          'opened',
          { astronautId, details: { trigger_type: triggerType, automatic: true, ...details } },
          db,
        );
      }
      if (session.status === 'pending') {
        const added = await model.insertDeadman(
          {
            sessionId: session.id,
            astronautId,
            triggerType,
            sourceReadingId: readingId,
            deadlineAt,
          },
          db,
        );
        if (added) {
          await C.event(
            session,
            'deadman_started',
            {
              astronautId,
              details: { deadline_at: deadlineAt.toISOString(), trigger_type: triggerType },
            },
            db,
          );
        }
      }
      return { id: session.id };
    });

  let outcome;
  try {
    outcome = await attempt();
  } catch (err) {
    if (!isUniqueOpen(err)) throw err;
    outcome = await attempt();
  }
  const session = await model.findSession(outcome.id);
  const mine = (await model.deadmanFor(session.id)).find((d) => d.astronaut_id === astronautId);
  return {
    session_id: session.id,
    status: session.status,
    trigger_type: session.trigger_type,
    deadline_at: mine ? mine.deadline_at : null,
  };
}

/** Desde el flujo de evaluación (POST /readings, /sync/push): una lectura quedó crítica. */
async function onCriticalReading({ reading, indicator, evaluation }) {
  if (!env.triage.autoEnabled || !env.triage.autoCriticalReading) return null;
  if (!evaluation || evaluation.level !== 'critical' || !reading.astronaut_id) return null;
  if (indicator.sensitivity !== 'standard') return null;
  const ageMin = (Date.now() - new Date(reading.measured_at).getTime()) / 60000;
  if (ageMin > env.triage.autoReadingMaxAgeMin) return null; // escala, pero no abre emergencia
  const protocol = await model.activeProtocol();
  const auto = protocol && protocol.definition.auto_activation;
  if (!auto || !(auto.critical_reading_indicators || []).includes(indicator.code)) return null;
  return activateAutomatic({
    missionId: reading.mission_id,
    astronautId: reading.astronaut_id,
    triggerType: 'critical_reading',
    key: reading.id,
    readingId: reading.id,
    details: { indicator_code: indicator.code, reading_id: reading.id },
  });
}

// ---------------------------------------------------------------- barridos (reloj inyectable)

/**
 * Interruptor de hombre muerto (idempotente, reloj inyectable). Vence los plazos de "estoy
 * bien" cumplidos a `now` y activa su sesión (aviso a bordo + escalamiento a Tierra); vence
 * los latidos de las sesiones activas. Cada UPDATE es condicional: nunca dispara dos veces,
 * aunque corran varios barridos a la vez. Lo llama un intervalo del servidor y cada lectura
 * de la sesión (en Render la instancia puede dormirse).
 */
async function sweepDeadman(now = new Date()) {
  return withTransaction(async (db) => {
    const expired = await model.expireDeadman(now, db);
    let activated = 0;
    for (const row of expired) {
      const session = await model.findSession(row.session_id, db);
      await C.event(
        session,
        'deadman_expired',
        { astronautId: row.astronaut_id, details: { deadline_at: row.deadline_at } },
        db,
      );
      if (await model.activateSession(session.id, db)) {
        activated += 1;
        const current = await model.findSession(session.id, db);
        await C.event(current, 'activated', { details: { reason: 'deadman_expired' } }, db);
        await C.escalateActivation(
          current,
          `sin "estoy bien" en ${env.triage.deadmanSeconds} s`,
          db,
        );
      }
    }
    const lapsed = await model.lapseHeartbeats(now, db);
    for (const row of lapsed) {
      const session = await model.findSession(row.id, db);
      await C.event(
        session,
        'heartbeat_lost',
        { details: { last_heartbeat_at: row.last_heartbeat_at } },
        db,
      );
      await C.escalate(
        {
          session,
          kind: `heartbeat:${new Date(row.last_heartbeat_at).toISOString()}`,
          targets: C.ACTIVATION_TARGETS,
          reason: `Emergencia en ${session.mission_code}: la tableta dejó de mandar latido.`,
        },
        db,
      );
    }
    return { expired: expired.length, activated, heartbeat_lapsed: lapsed.length };
  });
}

/** Desde cuándo cuenta el check-in perdido (null = no se detecta). */
async function missedCheckinSince() {
  const marker = await model.getMarker(HISTORY_MARKER);
  const candidates = [env.triage.autoSince, marker].filter(Boolean).map((d) => new Date(d));
  if (!candidates.length) return null;
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}

/**
 * Check-in perdido (alerta sin respuesta): un tripulante sin check-in en
 * TRIAGE_AUTO_MISSED_CHECKIN_H horas, contando desde la última carga de la historia del
 * simulador o TRIAGE_AUTO_SINCE. Una vez por ausencia (hasta el siguiente check-in).
 */
async function detectMissedCheckins(now = new Date()) {
  if (!env.triage.autoEnabled || !env.triage.autoMissedCheckin) return 0;
  const since = await missedCheckinSince();
  if (!since) return 0;
  const protocol = await model.activeProtocol();
  if (!protocol || !(protocol.definition.auto_activation || {}).missed_checkin) return 0;
  const limitMs = env.triage.autoMissedCheckinH * 3600 * 1000;
  let activated = 0;
  for (const mission of await model.activeMissions()) {
    for (const row of await model.checkinState(mission.id)) {
      const last = row.last_checkin_at ? new Date(row.last_checkin_at) : null;
      const reference = last && last > since ? last : since;
      if (new Date(now).getTime() - reference.getTime() <= limitMs) continue;
      if (row.last_missed_trigger_at && new Date(row.last_missed_trigger_at) >= reference) continue;
      const result = await activateAutomatic({
        missionId: mission.id,
        astronautId: row.astronaut_id,
        triggerType: 'missed_checkin',
        key: `${row.astronaut_id}:${reference.toISOString()}`,
        details: { hours_without_checkin: env.triage.autoMissedCheckinH },
        now,
      });
      if (result) activated += 1;
    }
  }
  return activated;
}

async function runTriageSweep(now = new Date()) {
  const missed = await detectMissedCheckins(now);
  const deadman = await sweepDeadman(now);
  return { missed_checkin: missed, ...deadman };
}

/** Marca la carga de la historia del simulador (desde ahí cuenta el check-in perdido). */
const markHistoryLoaded = (at = new Date()) => model.setMarker(HISTORY_MARKER, at);

// ---------------------------------------------------------------- acciones a bordo

async function openSessionFor(actor, ref) {
  const session = await C.resolveSession(ref);
  C.assertCrew(actor, session.mission_id);
  return session;
}

async function getSession({ actor, id }) {
  await runTriageSweep();
  const session = await C.resolveSession(id);
  if (C.isGround(actor)) {
    if (actor.role !== 'admin' && !actor.mission_ids.includes(session.mission_id)) {
      throw new HttpError(403, 'FORBIDDEN', 'No eres parte del equipo de esta misión.');
    }
    const delivered = await model.sessionEscalations(session.id, { groundDelivered: true });
    if (!delivered.length) throw notFound('La sesión de emergencia todavía no llegó a Tierra.');
    return sessionView(session, actor, { ground: true });
  }
  C.assertCrew(actor, session.mission_id);
  return sessionView(session, actor);
}

/** "Estoy bien" del tripulante afectado: si todos confirman, la sesión pending se cancela. */
async function confirmOk({ actor, id, input }) {
  const session = await openSessionFor(actor, id);
  if (actor.kind !== 'user' || !actor.astronaut_id) {
    throw new HttpError(403, 'FORBIDDEN', 'Solo el tripulante afectado confirma que está bien.');
  }
  const body = isPlainObject(input) ? input : {};
  const at = body.confirmed_at === undefined ? new Date().toISOString() : body.confirmed_at;
  const issue = timestampIssue(at);
  if (issue) throw badRequest([{ field: 'confirmed_at', issue }]);
  const outcome = await withTransaction(async (db) => {
    const result = await model.confirmDeadman(
      { sessionId: session.id, astronautId: actor.astronaut_id, userId: actor.user_id, at },
      db,
    );
    if (result === 'confirmed') {
      await C.event(
        session,
        'deadman_confirmed',
        { astronautId: actor.astronaut_id, actorUserId: actor.user_id, deviceAt: at },
        db,
      );
      const current = await model.findSession(session.id, db);
      if (current.status === 'pending' && (await model.unresolvedDeadman(session.id, db)) === 0) {
        await model.closeSession(
          { id: session.id, status: 'cancelled', closedAt: new Date().toISOString() },
          db,
        );
        await C.event(current, 'cancelled', { details: { reason: 'all_confirmed_ok' } }, db);
      }
    }
    return result;
  });
  if (outcome === 'none') {
    throw conflict('CONFLICT', 'No tienes una alerta de "estoy bien" pendiente en esta sesión.');
  }
  if (outcome === 'expired') {
    throw conflict('DEADMAN_EXPIRED', 'El plazo ya venció: la emergencia está activa.', {
      session_id: session.id,
    });
  }
  return sessionView(await model.findSession(session.id), actor);
}

async function heartbeat({ actor, id, input }) {
  const session = await openSessionFor(actor, id);
  const body = isPlainObject(input) ? input : {};
  const issue = timestampIssue(body.sent_at);
  if (issue) throw badRequest([{ field: 'sent_at', issue }]);
  if (session.status !== 'active') {
    throw conflict('CONFLICT', 'La sesión no está activa.', { status: session.status });
  }
  const protocol = await model.protocolById(session.protocol_id);
  const seconds = protocol.definition.dead_man_switch_seconds || 120;
  const row = await model.heartbeat(session.id, new Date().toISOString());
  if (!row) throw conflict('CONFLICT', 'La sesión no está activa.');
  return {
    session_id: session.id,
    status: 'active',
    received_at: row.last_heartbeat_at,
    dead_man_switch_seconds: seconds,
    expires_at: new Date(new Date(row.last_heartbeat_at).getTime() + seconds * 1000).toISOString(),
  };
}

/** Pregunta fuera del protocolo a Tierra: viaja con deliver_at por el hilo de la sesión. */
async function askEarth({ actor, id, input }) {
  const session = await openSessionFor(actor, id);
  const body = isPlainObject(input) ? input : {};
  const problems = [];
  if (!isUuid(body.client_uuid)) problems.push({ field: 'client_uuid', issue: 'debe ser un UUID' });
  if (typeof body.body !== 'string' || !body.body.trim() || body.body.length > 4000) {
    problems.push({ field: 'body', issue: 'debe ser texto (1 a 4000 caracteres)' });
  }
  if (body.asked_at !== undefined) {
    const issue = timestampIssue(body.asked_at);
    if (issue) problems.push({ field: 'asked_at', issue });
  }
  if (problems.length) throw badRequest(problems);
  if (!['active', 'closed'].includes(session.status)) {
    throw conflict('CONFLICT', 'La sesión todavía espera "estoy bien": no hay hilo con Tierra.', {
      status: session.status,
    });
  }
  const thread = await model.sessionThread(session.id);
  if (!thread) throw conflict('CONFLICT', 'La sesión no tiene hilo con Tierra.');
  return withTransaction(async (db) => {
    const { row, created } = await model.insertQuestion(
      {
        clientUuid: body.client_uuid,
        escalationId: thread.id,
        missionId: session.mission_id,
        authorId: C.actorUserId(actor),
        body: body.body.trim(),
      },
      db,
    );
    if (created) {
      await C.event(
        session,
        'question_to_earth',
        {
          clinical: true,
          actorUserId: C.actorUserId(actor),
          actorDevice: C.actorDevice(actor),
          details: { message_id: row.id },
          deviceAt: body.asked_at,
        },
        db,
      );
    }
    return {
      status: created ? 201 : 200,
      body: {
        id: row.id,
        session_id: session.id,
        escalation_id: row.escalation_id,
        direction: row.direction,
        body: row.body,
        created_at: row.created_at,
        deliver_at: row.deliver_at,
      },
    };
  });
}

// ---------------------------------------------------------------- cierre y reporte

const CLOSE_ROLES = ['commander', 'crew_medical_officer'];

function triageCounts(assessments) {
  const counts = { green: 0, yellow: 0, red: 0, black: 0, unreachable: 0, in_progress: 0 };
  for (const a of view.currentAssessments(assessments).values()) {
    if (a.status === 'completed' && counts[a.triage_category] !== undefined) {
      counts[a.triage_category] += 1;
    } else if (a.status === 'unreachable') counts.unreachable += 1;
    else counts.in_progress += 1;
  }
  return counts;
}

/**
 * Reporte completo para Tierra: línea de tiempo, evaluaciones con respuestas, clasificación,
 * versión del protocolo, diferencias dispositivo/servidor y preguntas. Sin bienestar.
 */
async function buildReport(sessionId, db) {
  const session = await model.findSession(sessionId, db);
  // En serie: es el cliente de la transacción (no admite consultas en paralelo).
  const protocol = await model.protocolById(session.protocol_id, db);
  const deadman = await model.deadmanFor(session.id, db);
  const merged = await model.mergedInto(session.id, db);
  const crew = await model.crewOfMission(session.mission_id, db);
  const assessments = await model.assessmentsFor(session.id, db);
  const events = await model.eventsFor(session.id, {}, db);
  const messages = await model.sessionMessages(session.id, {}, db);
  const withAnswers = [];
  for (const a of assessments) {
    withAnswers.push({
      ...C.toAssessment(a, { answers: await model.answersFor(a.id, db) }),
      protocol_id: a.protocol_id,
      server_result: a.result,
    });
  }
  return {
    generated_at: new Date().toISOString(),
    synthetic: true,
    disclaimer: protocol.definition.disclaimer || null,
    protocol: { id: protocol.id, code: protocol.code, version: protocol.version },
    session: C.toSession(session, { deadman, merged, protocol }),
    joined_activations: merged,
    counts: triageCounts(assessments),
    attention_order: view.attentionOrder({ crew, assessments, protocol: protocol.definition }),
    assessments: withAnswers,
    differences: assessments
      .filter((a) => a.matches_device === false)
      .map((a) => ({
        assessment_id: a.id,
        call_sign: a.call_sign,
        device_result: a.device_result,
        server_result: a.result
          ? {
              status: a.result.status,
              triage_category: a.result.triage_category ?? null,
              radiation_flag: a.result.radiation_flag ?? null,
              rules_version: a.rules_version,
            }
          : null,
        fields: (a.result && a.result.mismatch_fields) || [],
        used: 'server',
      })),
    timeline: events.map((e) => ({
      id: e.id,
      event_type: e.event_type,
      at: e.created_at,
      device_at: e.device_at,
      call_sign: e.call_sign,
      actor_role: e.actor_role,
      details: e.details,
    })),
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      author_role: m.author_role,
      body: m.body,
      created_at: m.created_at,
      deliver_at: m.deliver_at,
    })),
    wellbeing: 'No incluido: el triaje no usa datos de bienestar (decisión del MVP).',
  };
}

function checkCloseInput(input) {
  const body = isPlainObject(input) ? input : {};
  const problems = [];
  const issue = timestampIssue(body.closed_at);
  if (issue) problems.push({ field: 'closed_at', issue });
  if (!['closed', 'cancelled'].includes(body.status)) {
    problems.push({ field: 'status', issue: 'debe ser closed o cancelled' });
  }
  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== 'string' || body.notes.length > 2000) {
      problems.push({ field: 'notes', issue: 'debe ser texto (hasta 2000 caracteres)' });
    }
  }
  if (problems.length) throw badRequest(problems);
  return body;
}

async function summary(session, actor) {
  const [assessments, escalationRows] = await Promise.all([
    model.assessmentsFor(session.id),
    model.sessionEscalations(session.id),
  ]);
  const protocol = await model.protocolById(session.protocol_id);
  return {
    session: C.toSession(session, { protocol, deadman: await model.deadmanFor(session.id) }),
    counts: C.seesClinical(actor) ? triageCounts(assessments) : null,
    escalations: escalationRows.map(C.toEscalationRef),
  };
}

/**
 * Cierra (atendida) o cancela (falsa alarma) la sesión: comandante o CMO. Avisa a Tierra y
 * deja el reporte, que el flight surgeon ve cuando llega el evento de cierre (con cortes).
 * Cerrar una sesión que se fusionó cierra la principal (es el mismo incidente).
 */
async function closeSession({ actor, id, input }) {
  const body = checkCloseInput(input);
  const session = await openSessionFor(actor, id);
  if (actor.kind === 'user' && !CLOSE_ROLES.includes(actor.crew_role)) {
    throw new HttpError(
      403,
      'FORBIDDEN',
      'Solo el comandante o el oficial médico cierra la emergencia.',
      {
        required_crew_roles: CLOSE_ROLES,
      },
    );
  }
  if (!['pending', 'active'].includes(session.status)) {
    if (['closed', 'cancelled'].includes(session.status)) return summary(session, actor);
    throw conflict('CONFLICT', 'La sesión no está abierta.', { status: session.status });
  }
  await withTransaction(async (db) => {
    const closed = await model.closeSession(
      {
        id: session.id,
        status: body.status,
        closedAt: body.closed_at,
        closedBy: C.actorUserId(actor),
        notes: body.notes,
      },
      db,
    );
    if (!closed) return;
    const current = await model.findSession(session.id, db);
    await C.event(
      current,
      'closed',
      {
        actorUserId: C.actorUserId(actor),
        actorDevice: C.actorDevice(actor),
        details: { status: body.status },
        deviceAt: body.closed_at,
      },
      db,
    );
    await C.escalate(
      {
        session: current,
        kind: 'closed',
        targets: [
          { level: 'flight_surgeon', priority: body.status === 'closed' ? 'urgent' : 'routine' },
        ],
        reason:
          body.status === 'closed'
            ? `Emergencia cerrada en ${current.mission_code}: reporte disponible.`
            : `Emergencia cancelada en ${current.mission_code} (falsa alarma): reporte disponible.`,
      },
      db,
    );
    await model.insertReport(session.id, await buildReport(session.id, db), db);
  });
  return summary(await model.findSession(session.id), actor);
}

module.exports = {
  TRIGGERS,
  HISTORY_MARKER,
  sessionView,
  createSession,
  activateAutomatic,
  onCriticalReading,
  sweepDeadman,
  detectMissedCheckins,
  runTriageSweep,
  markHistoryLoaded,
  getSession,
  confirmOk,
  heartbeat,
  askEarth,
  closeSession,
  buildReport,
  triageCounts,
};
