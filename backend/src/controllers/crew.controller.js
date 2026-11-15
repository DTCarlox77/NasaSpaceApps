'use strict';

const delegation = require('../services/delegation.service');
const crewStatus = require('../services/crewStatus.service');

async function unlockUser(req, res) {
  res.json(
    await delegation.unlockUser({
      userId: req.auth.userId,
      id: req.params.id,
      deviceId: req.auth.deviceId,
      ip: req.ip,
    }),
  );
}

async function resetPin(req, res) {
  res.json(
    await delegation.resetPin({
      userId: req.auth.userId,
      id: req.params.id,
      deviceId: req.auth.deviceId,
      ip: req.ip,
    }),
  );
}

async function registerDevice(req, res) {
  res
    .status(201)
    .json(await delegation.registerDevice({ userId: req.auth.userId, body: req.body, ip: req.ip }));
}

async function audit(req, res) {
  res.json(await delegation.groundAudit({ userId: req.auth.userId, query: req.query }));
}

async function status(req, res) {
  res.json(await crewStatus.crewStatus({ userId: req.auth.userId }));
}

module.exports = { unlockUser, resetPin, registerDevice, audit, status };
