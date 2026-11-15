'use strict';

const devicesService = require('../services/devices.service');
const { loadActor } = require('../services/accessPolicy');
const { forbidden } = require('../utils/httpError');

async function actorOf(req) {
  const actor = await loadActor(req.auth.userId);
  if (!actor) throw forbidden();
  return actor;
}

async function register(req, res) {
  res
    .status(201)
    .json(
      await devicesService.adminRegister({ actor: await actorOf(req), body: req.body, ip: req.ip }),
    );
}

async function list(req, res) {
  res.json(await devicesService.adminList({ query: req.query }));
}

async function revoke(req, res) {
  res.json(
    await devicesService.adminRevoke({ actor: await actorOf(req), id: req.params.id, ip: req.ip }),
  );
}

module.exports = { register, list, revoke };
