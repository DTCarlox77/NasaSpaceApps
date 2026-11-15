'use strict';

/**
 * Evaluación del triaje por tripulante (tarea 9).
 *
 * - La app lee las preguntas en voz alta y responde con botones: el servidor solo acepta
 *   respuestas de vocabulario cerrado (las opciones de la pregunta en el protocolo).
 * - Al completar, el servidor recalcula con evaluateAssessment (src/engine/triage.js, el
 *   mismo evaluador del dispositivo) y la versión del protocolo con que se evaluó. Si la
 *   tableta calculó otra cosa, se guardan las dos, se marca la diferencia (matches_device =
 *   false, evento device_mismatch) y se usa la del servidor para priorizar.
 * - Reevaluación append-only: una evaluación nueva del mismo tripulante no borra la anterior
 *   (reassessment_of); manda la última completada.
 */
const { badRequest, conflict, notFound } = require('../utils/httpError');
const { isUuid } = require('../utils/validate');
const { derivedUuid } = require('../utils/derivedUuid');
const { evaluateAssessment } = require('../engine/triage');
const { withTransaction } = require('../models/transaction');
const model = require('../models/emergency.model');
const { measuredAtIssue } = require('./readingValidation');
const view = require('./triageView');
const C = require('./emergencyCommon');

const SOURCES = ['tap', 'voice', 'prefill', 'auto'];
const MAX_ANSWERS = 50;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

async function assessmentFor(actor, ref) {
  const assessment = await model.findAssessmentByRef(C.refParam(ref));
  if (!assessment) throw notFound('La evaluación no existe.');
  const session = await C.resolveSession(assessment.session_id);
  C.assertCrew(actor, session.mission_id);
  return { assessment, session };
}

// ---------------------------------------------------------------- iniciar

async function createAssessment({ actor, sessionId, input }) {
  const body = isPlainObject(input) ? input : {};
  const problems = [];
  if (!isUuid(body.client_uuid)) problems.push({ field: 'client_uuid', issue: 'debe ser un UUID' });
  if (!isUuid(body.astronaut_id))
    problems.push({ field: 'astronaut_id', issue: 'debe ser un UUID' });
  if (
    body.sequence_no !== undefined &&
    (!Number.isInteger(body.sequence_no) || body.sequence_no < 1)
  ) {
    problems.push({ field: 'sequence_no', issue: 'debe ser un entero ≥ 1' });
  }
  if (body.is_self_assessment !== undefined && typeof body.is_self_assessment !== 'boolean') {
    problems.push({ field: 'is_self_assessment', issue: 'debe ser true o false' });
  }
  const issue = measuredAtIssue(body.started_at);
  if (issue) problems.push({ field: 'started_at', issue });
  if (problems.length) throw badRequest(problems);

  const existing = await model.findAssessmentByRef(body.client_uuid);
  if (existing && existing.client_uuid === body.client_uuid) {
    const session = await C.resolveSession(existing.session_id);
    C.assertCrew(actor, session.mission_id);
    return { status: 200, body: C.toAssessment(existing) };
  }

  const session = await C.resolveSession(C.refParam(sessionId));
  C.assertCrew(actor, session.mission_id);
  if (!['pending', 'active'].includes(session.status)) {
    throw conflict('SESSION_CLOSED', 'La sesión de emergencia está cerrada.', {
      session_id: session.id,
      status: session.status,
    });
  }
  const crew = await model.crewOfMission(session.mission_id);
  const member = crew.find((m) => m.astronaut_id === body.astronaut_id);
  if (!member) {
    throw badRequest([
      { field: 'astronaut_id', issue: 'no es de la tripulación vigente de la misión' },
    ]);
  }
  if (body.is_self_assessment && actor.astronaut_id !== body.astronaut_id) {
    throw badRequest([
      { field: 'is_self_assessment', issue: 'una autoevaluación es de quien la hace' },
    ]);
  }
  const protocol = await model.protocolById(session.protocol_id);

  const id = await withTransaction(async (db) => {
    // Alguien empezó a evaluar: la sesión que esperaba "estoy bien" ya es real.
    if (session.status === 'pending' && (await model.activateSession(session.id, db))) {
      const current = await model.findSession(session.id, db);
      await C.event(current, 'activated', { details: { reason: 'assessment_started' } }, db);
      await C.escalateActivation(current, 'la tripulación empezó a evaluar', db);
    }
    const previous = await model.latestAssessmentOf(session.id, body.astronaut_id, db);
    const inserted = await model.insertAssessment(
      {
        clientUuid: body.client_uuid,
        sessionId: session.id,
        astronautId: body.astronaut_id,
        assessedBy: C.actorUserId(actor),
        isSelfAssessment: Boolean(body.is_self_assessment),
        sequenceNo: body.sequence_no || crew.indexOf(member) + 1,
        startedAt: body.started_at,
        protocolId: protocol.id,
        reassessmentOf: previous,
        rulesVersion: protocol.version,
      },
      db,
    );
    if (!inserted.created) return (await model.findAssessmentByRef(body.client_uuid, db)).id;
    // La respuesta de sesión responder_safe se copia en cada evaluación (source: auto).
    if (session.responder_safe !== null && session.responder_safe !== undefined) {
      await model.insertAnswer(
        {
          clientUuid: derivedUuid('emergency-answer', inserted.id, 'responder_safe'),
          assessmentId: inserted.id,
          questionCode: 'responder_safe',
          answer: { value: session.responder_safe },
          source: 'auto',
          answeredAt: session.started_at,
        },
        db,
      );
    }
    await C.event(
      session,
      'assessment_started',
      {
        astronautId: body.astronaut_id,
        assessmentId: inserted.id,
        actorUserId: C.actorUserId(actor),
        actorDevice: C.actorDevice(actor),
        details: { reassessment_of: previous },
        deviceAt: body.started_at,
      },
      db,
    );
    return inserted.id;
  });
  return { status: 201, body: C.toAssessment(await model.findAssessment(id)) };
}

// ---------------------------------------------------------------- respuestas

function checkAnswer(raw, index, questions) {
  const a = isPlainObject(raw) ? raw : {};
  const field = (name) => `answers[${index}].${name}`;
  const problems = [];
  if (!isUuid(a.client_uuid))
    problems.push({ field: field('client_uuid'), issue: 'debe ser un UUID' });
  const question = questions.get(a.question_code);
  const issue = view.answerIssue(question, a.answer);
  if (issue) problems.push({ field: field('answer'), issue: `${a.question_code}: ${issue}` });
  if (!SOURCES.includes(a.source)) {
    problems.push({ field: field('source'), issue: `debe ser uno de: ${SOURCES.join(', ')}` });
  }
  if (
    a.source_reading_id !== undefined &&
    a.source_reading_id !== null &&
    !isUuid(a.source_reading_id)
  ) {
    problems.push({ field: field('source_reading_id'), issue: 'debe ser un UUID' });
  }
  const when = measuredAtIssue(a.answered_at);
  if (when) problems.push({ field: field('answered_at'), issue: when });
  return problems;
}

async function evaluate(assessment, session, db) {
  const protocol = await model.protocolById(assessment.protocol_id || session.protocol_id, db);
  const answers = view.latestAnswers(await model.answersFor(assessment.id, db));
  // responder_safe es de la sesión: si la evaluación no la tiene copiada, se usa la de la sesión.
  if (answers.responder_safe === undefined && session.responder_safe !== null) {
    answers.responder_safe = { value: session.responder_safe };
  }
  try {
    return {
      protocol,
      result: evaluateAssessment(protocol.definition, answers, session.context || {}),
    };
  } catch (err) {
    throw badRequest(
      [{ field: 'answers', issue: err.message }],
      'Las respuestas no siguen el protocolo.',
    );
  }
}

/** PUT /emergency/assessments/{id}/answers: lote idempotente + vista previa del resultado. */
async function putAnswers({ actor, id, input }) {
  const { assessment, session } = await assessmentFor(actor, id);
  const list = isPlainObject(input) ? input.answers : undefined;
  if (!Array.isArray(list) || !list.length || list.length > MAX_ANSWERS) {
    throw badRequest([
      { field: 'answers', issue: `debe ser una lista de 1 a ${MAX_ANSWERS} respuestas` },
    ]);
  }
  const protocol = await model.protocolById(assessment.protocol_id || session.protocol_id);
  const questions = new Map(protocol.definition.questions.map((q) => [q.code, q]));
  const problems = list.flatMap((a, i) => checkAnswer(a, i, questions));
  if (problems.length) throw badRequest(problems);
  if (assessment.status !== 'in_progress') {
    throw conflict(
      'ASSESSMENT_COMPLETED',
      'Esta evaluación ya está completada: para cambiar algo, inicia una reevaluación.',
      { assessment_id: assessment.id },
    );
  }
  let accepted = 0;
  let duplicates = 0;
  const preview = await withTransaction(async (db) => {
    for (const a of list) {
      const created = await model.insertAnswer(
        {
          clientUuid: a.client_uuid,
          assessmentId: assessment.id,
          questionCode: a.question_code,
          answer: a.answer,
          source: a.source,
          sourceReadingId: a.source_reading_id,
          answeredAt: a.answered_at,
        },
        db,
      );
      if (created) accepted += 1;
      else duplicates += 1;
      // Sesión automática: nadie contestó responder_safe al abrirla; vale para todas.
      if (a.question_code === 'responder_safe') {
        await model.setResponderSafe(session.id, a.answer.value, db);
      }
    }
    const { protocol: used, result } = await evaluate(assessment, session, db);
    return toResult(result, { protocol: used, device: null });
  });
  return { accepted, duplicates, preview };
}

// ---------------------------------------------------------------- completar

function toResult(
  result,
  { protocol, device, compare = { matches: null, fields: [] }, escalations = [] },
) {
  const out = {
    status: result.status,
    triage_category: result.triage_category ?? null,
    escalations: (result.escalations || []).map((action) => {
      const created = escalations.find((e) => e.level === action.level);
      return created
        ? { ...action, escalation_id: created.id, deliver_at: created.deliver_at }
        : { ...action };
    }),
    path: result.path,
    computed_by: 'server',
    rules_version: protocol.version,
    matches_device: compare.matches,
  };
  if (result.status === 'completed') {
    out.radiation_flag = result.radiation_flag;
    out.priority = view.maxPriority(result.escalations);
  }
  if (result.pending) out.pending = result.pending;
  if (result.reason) out.reason = result.reason;
  if (device) out.device_result = device;
  if (compare.fields.length) out.mismatch_fields = compare.fields;
  // El escalamiento a Tierra de la evaluación (siempre hay uno al completar).
  const ground = escalations.find((e) => e.level === 'flight_surgeon');
  if (ground && !out.escalations.some((e) => e.level === 'flight_surgeon')) {
    out.escalations.push({
      level: 'flight_surgeon',
      priority: ground.priority,
      escalation_id: ground.id,
      deliver_at: ground.deliver_at,
    });
  }
  return out;
}

function checkDevice(device) {
  if (device === undefined || device === null) return null;
  if (!isPlainObject(device))
    throw badRequest([{ field: 'device_result', issue: 'debe ser un objeto' }]);
  const out = {};
  for (const key of ['status', 'triage_category', 'radiation_flag', 'rules_version']) {
    if (device[key] !== undefined) out[key] = device[key];
  }
  return out;
}

/** Siguiente tripulante por evaluar (roster sin evaluación completada). */
async function nextToAssess(session) {
  const [crew, assessments] = await Promise.all([
    model.crewOfMission(session.mission_id),
    model.assessmentsFor(session.id),
  ]);
  const done = new Set(
    assessments.filter((a) => a.status === 'completed').map((a) => a.astronaut_id),
  );
  const entry = view.roster({ crew }).find((r) => !done.has(r.astronaut_id));
  return { entry: entry || null, crew, assessments };
}

/**
 * POST /emergency/assessments/{id}/complete: el servidor recalcula y su resultado manda.
 * completed → guarda la clasificación, escala (crew a bordo; flight_surgeon con
 * compute_deliver_at y cortes) y agrega el evento a la línea de tiempo.
 */
async function completeAssessment({ actor, id, input }) {
  const { assessment, session } = await assessmentFor(actor, id);
  const body = isPlainObject(input) ? input : {};
  const issue = measuredAtIssue(body.completed_at);
  if (issue) throw badRequest([{ field: 'completed_at', issue }]);
  const device = checkDevice(body.device_result);

  if (assessment.status === 'completed') {
    // Idempotente: lo que ya se calculó (no se vuelve a escalar).
    const protocol = await model.protocolById(assessment.protocol_id);
    const rows = await model.sessionEscalations(session.id);
    const mine = rows.filter((e) => e.source_id === assessment.id);
    const { entry } = await nextToAssess(session);
    return {
      ...toResult(assessment.result, {
        protocol,
        device: assessment.device_result,
        compare: {
          matches: assessment.matches_device,
          fields: (assessment.result && assessment.result.mismatch_fields) || [],
        },
        escalations: mine,
      }),
      next: entry,
    };
  }

  const out = await withTransaction(async (db) => {
    const locked = await model.lockAssessment(assessment.id, db);
    const { protocol, result } = await evaluate(locked, session, db);
    const compare = view.compareDevice(device, result, protocol.version);
    const stored = { ...result, mismatch_fields: compare.fields };
    let created = [];
    if (result.status === 'completed') {
      await model.completeAssessment(
        {
          id: locked.id,
          triageCategory: result.triage_category,
          radiationFlag: result.radiation_flag,
          completedAt: body.completed_at,
          rulesVersion: protocol.version,
          result: stored,
          deviceResult: device,
          matches: compare.matches,
        },
        db,
      );
      const current = await model.findSession(session.id, db);
      if (current.status === 'pending' && (await model.activateSession(current.id, db))) {
        await C.event(current, 'activated', { details: { reason: 'assessment_completed' } }, db);
        await C.escalateActivation(current, 'la tripulación completó una evaluación', db);
      }
      // Acciones del protocolo y, siempre, aviso a Tierra (prioridad de las acciones).
      const targets = (result.escalations || []).filter((a) => a.level !== 'self_care');
      if (!targets.some((a) => a.level === 'flight_surgeon')) {
        targets.push({
          level: 'flight_surgeon',
          priority: view.maxPriority(result.escalations) || 'routine',
        });
      }
      created = await C.escalate(
        {
          session: current,
          kind: 'assessment_completed',
          sourceType: 'emergency_assessment',
          sourceId: locked.id,
          astronautId: locked.astronaut_id,
          targets,
          reason: `Emergencia en ${current.mission_code}: evaluación de ${locked.call_sign} completada.`,
        },
        db,
      );
      await C.event(
        current,
        'assessment_completed',
        {
          clinical: true,
          astronautId: locked.astronaut_id,
          assessmentId: locked.id,
          actorUserId: C.actorUserId(actor),
          actorDevice: C.actorDevice(actor),
          details: {
            triage_category: result.triage_category,
            radiation_flag: result.radiation_flag,
            rules_version: protocol.version,
            matches_device: compare.matches,
          },
          deviceAt: body.completed_at,
        },
        db,
      );
    } else {
      await model.saveProvisional(
        { id: locked.id, result: stored, deviceResult: device, matches: compare.matches },
        db,
      );
    }
    if (compare.matches === false) {
      await C.event(
        session,
        'device_mismatch',
        {
          clinical: true,
          astronautId: locked.astronaut_id,
          assessmentId: locked.id,
          clientUuid: derivedUuid('emergency-event', locked.id, 'mismatch', JSON.stringify(device)),
          details: {
            device_result: device,
            server_result: {
              status: result.status,
              triage_category: result.triage_category ?? null,
              radiation_flag: result.radiation_flag ?? null,
              rules_version: protocol.version,
            },
            fields: compare.fields,
            used: 'server',
          },
        },
        db,
      );
    }
    return toResult(result, { protocol, device, compare, escalations: created });
  });
  const { entry, crew, assessments } = await nextToAssess(session);
  const protocol = await model.protocolById(session.protocol_id);
  return {
    ...out,
    next: entry,
    attention_order: view.attentionOrder({ crew, assessments, protocol: protocol.definition }),
  };
}

/** Sync (emergency_answer): una respuesta suelta, con la referencia de su evaluación. */
async function putOneAnswer({ actor, clientUuid, payload }) {
  if (!isPlainObject(payload))
    throw badRequest([{ field: 'payload', issue: 'debe ser un objeto' }]);
  const ref = payload.assessment_id ?? payload.assessment_client_uuid;
  if (!isUuid(ref)) {
    throw badRequest([
      { field: 'payload.assessment_id', issue: 'id o client_uuid de la evaluación' },
    ]);
  }
  const answer = { ...payload };
  delete answer.assessment_id;
  delete answer.assessment_client_uuid;
  const result = await putAnswers({
    actor,
    id: ref,
    input: { answers: [{ ...answer, client_uuid: clientUuid }] },
  });
  const { assessment } = await assessmentFor(actor, ref);
  return { ...result, assessment_id: assessment.id };
}

module.exports = {
  createAssessment,
  putAnswers,
  putOneAnswer,
  completeAssessment,
};
