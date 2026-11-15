'use strict';

/**
 * Modo emergencia (tarea 9). El controlador arma el ACTOR (el usuario de la sesión o, desde la
 * tarea 11, la tableta con X-Device-Credential: deviceActor) y los servicios trabajan con él,
 * nunca con req.user.
 */
const emergency = require('../services/emergency.service');
const assessments = require('../services/triageAssessment.service');
const ground = require('../services/emergencyGround.service');
const model = require('../models/emergency.model');
const authEvents = require('../models/authEvents.model');
const { userActor, deviceActor } = require('../services/emergencyCommon');
const { badRequest, notFound } = require('../utils/httpError');

const actorOf = async (req) =>
  req.device
    ? deviceActor({
        deviceId: req.device.id,
        missionId: req.device.mission_id,
        label: req.device.label,
      })
    : userActor(req.auth.userId);

async function protocol(req, res) {
  let row;
  if (req.query.version !== undefined) {
    const version = Number(req.query.version);
    if (!Number.isInteger(version) || version < 1) {
      throw badRequest([{ field: 'version', issue: 'debe ser un entero ≥ 1' }]);
    }
    row = await model.protocolByVersion(version);
  } else row = await model.activeProtocol();
  if (!row) throw notFound('No existe esa versión del protocolo.');
  res.json({
    id: row.id,
    code: row.code,
    version: row.version,
    name: row.name,
    is_active: row.is_active,
    sources: row.sources,
    definition: row.definition,
  });
}

async function createSession(req, res) {
  const { status, body } = await emergency.createSession({
    actor: await actorOf(req),
    input: req.body,
  });
  // Emergencia iniciada (o unida) sin sesión de usuario: queda en la bitácora de autenticación.
  if (req.device && status === 201) {
    await authEvents.record({
      event: 'device_emergency_started',
      deviceId: req.device.id,
      ip: req.ip,
    });
  }
  res.status(status).json(body);
}

async function getSession(req, res) {
  res.json(await emergency.getSession({ actor: await actorOf(req), id: req.params.id }));
}

async function confirm(req, res) {
  res.json(
    await emergency.confirmOk({ actor: await actorOf(req), id: req.params.id, input: req.body }),
  );
}

async function heartbeat(req, res) {
  res.json(
    await emergency.heartbeat({ actor: await actorOf(req), id: req.params.id, input: req.body }),
  );
}

async function question(req, res) {
  const { status, body } = await emergency.askEarth({
    actor: await actorOf(req),
    id: req.params.id,
    input: req.body,
  });
  res.status(status).json(body);
}

async function close(req, res) {
  res.json(
    await emergency.closeSession({ actor: await actorOf(req), id: req.params.id, input: req.body }),
  );
}

async function createAssessment(req, res) {
  const { status, body } = await assessments.createAssessment({
    actor: await actorOf(req),
    sessionId: req.params.id,
    input: req.body,
  });
  res.status(status).json(body);
}

async function putAnswers(req, res) {
  res.json(
    await assessments.putAnswers({ actor: await actorOf(req), id: req.params.id, input: req.body }),
  );
}

async function complete(req, res) {
  res.json(
    await assessments.completeAssessment({
      actor: await actorOf(req),
      id: req.params.id,
      input: req.body,
    }),
  );
}

async function groundList(req, res) {
  res.json(await ground.list({ actor: await actorOf(req), query: req.query }));
}

async function groundDetail(req, res) {
  res.json(await ground.detail({ actor: await actorOf(req), id: req.params.id }));
}

module.exports = {
  protocol,
  createSession,
  getSession,
  confirm,
  heartbeat,
  question,
  close,
  createAssessment,
  putAnswers,
  complete,
  groundList,
  groundDetail,
};
