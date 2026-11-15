'use strict';

/**
 * Registro de tipos de POST /sync/push (tarea 8). Cada tipo traduce su `payload` (el mismo
 * body que el endpoint en línea, sin client_uuid) y llama al servicio real: así una lectura
 * que llega por sync se valida, se evalúa y escala igual que en línea.
 *
 * Extensible: registerEntity(nombre, { when, handle, priority, order, idempotentBySync }).
 * - priority: 'emergency' → se procesa antes que todo, aunque el item diga normal;
 * - order: orden entre los de emergencia (sesión → evaluación → respuestas → completar → cerrar);
 * - idempotentBySync: un reintento con el mismo contenido es duplicate sin volver a ejecutar
 *   (acciones que cambian estado y no tienen client_uuid propio en la base).
 * Un tipo sin handler responde rejected (ENTITY_NOT_SUPPORTED o UNKNOWN_ENTITY), sin tumbar
 * el lote.
 *
 * handle({ userId, item, payload }) → { status: 'accepted' | 'duplicate', serverId, result }
 * o lanza HttpError (409 → conflict, el resto → rejected).
 *
 * Bienestar (CONFIDENCIAL): pasa por wellbeing.service (el mismo de /wellbeing/*) y el
 * resultado es un mensaje NEUTRO, nunca un nivel, un puntaje ni un escalamiento.
 */
const { HttpError, conflict } = require('../utils/httpError');
const readings = require('../models/readings.model');
const readingsService = require('./readings.service');
const habitatService = require('./habitat.service');
const wellbeingService = require('./wellbeing.service');
const supportService = require('./supportRequest.service');

const ENTITIES = new Map();

/** when(payload) → measured_at del dispositivo (para ordenar, el reloj y late_sync). */
function registerEntity(
  name,
  { when, handle, priority = 'normal', order = 100, idempotentBySync = false },
) {
  ENTITIES.set(name, { when, handle, priority, order, idempotentBySync });
}

// Tipos del contrato que todavía no tienen servicio: rejected con un código claro.
const PENDING = new Set();

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const measuredAt = (payload) => payload.measured_at;

/** Igualdad estructural de JSON (orden de claves indiferente). */
function sameJson(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => sameJson(x, b[i]))
    );
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => Object.hasOwn(b, k) && sameJson(a[k], b[k]))
  );
}

const mismatch = (serverId) =>
  conflict(
    'PAYLOAD_MISMATCH',
    'Ya existe un registro con ese client_uuid y otro contenido. Para corregirlo usa supersedes_uuid con un client_uuid nuevo.',
    { server_id: serverId },
  );

// ---------------------------------------------------------------- reading (= POST /readings)

/** ¿El payload es la misma lectura que la guardada (creada en línea o por sync)? */
function sameReading(row, input) {
  return (
    row.indicator_code === input.indicator_code &&
    row.source === input.input_method &&
    new Date(row.measured_at).getTime() === new Date(input.measured_at).getTime() &&
    (row.supersedes_uuid || null) === (input.supersedes_uuid || null) &&
    sameJson(row.components, input.values)
  );
}

registerEntity('reading', {
  when: measuredAt,
  async handle({ userId, item, payload }) {
    const input = readingsService.validateReadingBody(
      {
        ...payload,
        client_uuid: item.client_uuid,
        supersedes_uuid: payload.supersedes_uuid ?? item.supersedes_uuid,
      },
      { prefix: 'payload.' },
    );
    // Append-only: el mismo client_uuid con otro contenido nunca sobrescribe.
    const existing = await readings.findByAuthor(userId, item.client_uuid);
    if (existing && !sameReading(existing, input)) throw mismatch(existing.id);
    const { status, body } = await readingsService.createReading({ userId, input });
    return {
      status: status === 201 ? 'accepted' : 'duplicate',
      serverId: body.reading.id,
      result: { evaluation: body.evaluation, escalation_id: body.escalation_id },
    };
  },
});

// ---------------------------------------------------------------- habitat_reading (lectura manual)

registerEntity('habitat_reading', {
  when: measuredAt,
  async handle({ userId, item, payload }) {
    const { results } = await habitatService.createHabitatReadings({
      userId,
      body: { readings: [{ ...payload, client_uuid: item.client_uuid }] },
    });
    const r = results[0];
    if (r.status === 'rejected') {
      throw new HttpError(400, r.error.code, r.error.message, r.error.details);
    }
    return {
      status: r.status,
      serverId: r.reading_id,
      result: { evaluation: r.evaluation, escalation_id: r.escalation_id },
    };
  },
});

// ---------------------------------------------------------------- bienestar (confidencial)
// Mismo servicio que POST /wellbeing/* (wellbeing.service, tarea 10): misma validación, mismo
// check-in por día (el segundo del día es una corrección) y la misma respuesta neutra (el
// mensaje de la regla, la racha y offer_support), sin id/client_uuid/received_at, que ya van
// en el resultado del item.

/** El body del endpoint en línea, sin lo que ya va en el resultado del item. */
const wellbeingResult = ({ id: _id, client_uuid: _c, received_at: _r, ...rest }) => rest;

const wellbeingEntity = (name, submit) =>
  registerEntity(name, {
    when: measuredAt,
    async handle({ userId, item, payload }) {
      const { status, body } = await wellbeingService[submit]({
        userId,
        body: payload,
        clientUuid: item.client_uuid,
        prefix: 'payload.',
      });
      return {
        status: status === 201 ? 'accepted' : 'duplicate',
        serverId: body.id,
        result: wellbeingResult(body),
      };
    },
  });

wellbeingEntity('wellbeing_checkin', 'submitCheckin');
wellbeingEntity('pvt_run', 'submitPvtRun');
wellbeingEntity('wellbeing_screening', 'submitScreening');

// "Quiero hablar con alguien": solo behavioral_health la ve; viaja con deliver_at. El mismo
// client_uuid con otro contenido es un conflicto (append-only).
registerEntity('support_request', {
  when: (p) => p.created_at,
  async handle({ userId, item, payload }) {
    const { status, body } = await supportService.createSupportRequest({
      userId,
      body: payload,
      clientUuid: item.client_uuid,
      prefix: 'payload.',
      strict: true,
    });
    return {
      status: status === 201 ? 'accepted' : 'duplicate',
      serverId: body.id,
      result: {
        status: body.status,
        urgency: body.urgency,
        channel: body.channel,
        deliver_at: body.deliver_at,
        suggestions: body.suggestions,
      },
    };
  },
});

// ---------------------------------------------------------------- emergencia (tarea 9)
// Prioridad emergency (antes que todo), idempotentes por client_uuid. Las referencias
// (session_id, assessment_id) aceptan el id del servidor o el client_uuid: sin conexión la
// app solo conoce los suyos. Una sesión creada sin conexión cuando ya había otra abierta en
// la misión se fusiona con ella (merged_into); sus evaluaciones van a la principal.

const lazy = {
  common: () => require('./emergencyCommon'),
  emergency: () => require('./emergency.service'),
  triage: () => require('./triageAssessment.service'),
  model: () => require('../models/emergency.model'),
};
const emergencyActor = (userId) => lazy.common().userActor(userId);
const sessionRef = (payload) => payload.session_id ?? payload.session_client_uuid;

const emergencyEntity = (name, order, spec) =>
  registerEntity(name, { priority: 'emergency', order, ...spec });

emergencyEntity('emergency_session', 10, {
  when: (p) => p.started_at,
  async handle({ userId, item, payload }) {
    const { status, body } = await lazy.emergency().createSession({
      actor: await emergencyActor(userId),
      input: { ...payload, client_uuid: item.client_uuid },
    });
    const own = await lazy.model().findSessionByClientUuid(item.client_uuid);
    return {
      status: status === 201 ? 'accepted' : 'duplicate',
      serverId: own ? own.id : body.session.id,
      result: {
        session_id: body.session.id,
        status: body.session.status,
        joined: body.joined,
        merged_into: own && own.merged_into ? own.merged_into : null,
      },
    };
  },
});

emergencyEntity('emergency_confirm', 15, {
  idempotentBySync: true,
  when: (p) => p.confirmed_at,
  async handle({ userId, payload }) {
    const out = await lazy.emergency().confirmOk({
      actor: await emergencyActor(userId),
      id: sessionRef(payload),
      input: payload,
    });
    return {
      status: 'accepted',
      serverId: out.session.id,
      result: { session_id: out.session.id, status: out.session.status },
    };
  },
});

emergencyEntity('emergency_assessment', 20, {
  when: (p) => p.started_at,
  async handle({ userId, item, payload }) {
    const { status, body } = await lazy.triage().createAssessment({
      actor: await emergencyActor(userId),
      sessionId: sessionRef(payload),
      input: { ...payload, client_uuid: item.client_uuid },
    });
    return {
      status: status === 201 ? 'accepted' : 'duplicate',
      serverId: body.id,
      result: { assessment_id: body.id, session_id: body.session_id, status: body.status },
    };
  },
});

emergencyEntity('emergency_answer', 30, {
  when: (p) => p.answered_at,
  async handle({ userId, item, payload }) {
    const out = await lazy.triage().putOneAnswer({
      actor: await emergencyActor(userId),
      clientUuid: item.client_uuid,
      payload,
    });
    return {
      status: out.accepted ? 'accepted' : 'duplicate',
      serverId: out.assessment_id,
      result: { assessment_id: out.assessment_id, preview: out.preview },
    };
  },
});

emergencyEntity('emergency_complete', 40, {
  idempotentBySync: true,
  when: (p) => p.completed_at,
  async handle({ userId, payload }) {
    const ref = payload.assessment_id ?? payload.assessment_client_uuid;
    const found = await lazy
      .model()
      .findAssessmentByRef(lazy.common().refParam(ref, 'payload.assessment_id'));
    const out = await lazy.triage().completeAssessment({
      actor: await emergencyActor(userId),
      id: ref,
      input: payload,
    });
    return {
      status: found && found.status === 'completed' ? 'duplicate' : 'accepted',
      serverId: found ? found.id : null,
      result: out,
    };
  },
});

emergencyEntity('emergency_heartbeat', 45, {
  idempotentBySync: true,
  when: (p) => p.sent_at,
  async handle({ userId, payload }) {
    const out = await lazy.emergency().heartbeat({
      actor: await emergencyActor(userId),
      id: sessionRef(payload),
      input: payload,
    });
    return { status: 'accepted', serverId: out.session_id, result: out };
  },
});

emergencyEntity('emergency_question', 50, {
  when: (p) => p.asked_at,
  async handle({ userId, item, payload }) {
    const { status, body } = await lazy.emergency().askEarth({
      actor: await emergencyActor(userId),
      id: sessionRef(payload),
      input: { ...payload, client_uuid: item.client_uuid },
    });
    return { status: status === 201 ? 'accepted' : 'duplicate', serverId: body.id, result: body };
  },
});

emergencyEntity('emergency_close', 90, {
  idempotentBySync: true,
  when: (p) => p.closed_at,
  async handle({ userId, payload }) {
    const ref = sessionRef(payload);
    const found = await lazy.common().resolveSession(ref);
    const out = await lazy.emergency().closeSession({
      actor: await emergencyActor(userId),
      id: ref,
      input: payload,
    });
    return {
      status: ['closed', 'cancelled'].includes(found.status) ? 'duplicate' : 'accepted',
      serverId: out.session.id,
      result: { session_id: out.session.id, status: out.session.status },
    };
  },
});

/** Handler del tipo, o el error con que se rechaza. */
function entityFor(name) {
  if (ENTITIES.has(name)) return { handler: ENTITIES.get(name) };
  if (PENDING.has(name)) {
    return {
      error: new HttpError(
        422,
        'ENTITY_NOT_SUPPORTED',
        `El servidor todavía no acepta ${name} por sincronización.`,
        { entity: name },
      ),
    };
  }
  return {
    error: new HttpError(422, 'UNKNOWN_ENTITY', `Tipo de registro desconocido: ${name}.`, {
      entity: name,
      supported: [...ENTITIES.keys()],
    }),
  };
}

module.exports = { registerEntity, entityFor, sameJson, ENTITIES };
