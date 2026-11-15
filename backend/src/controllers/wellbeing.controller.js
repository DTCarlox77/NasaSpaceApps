'use strict';

const wellbeingService = require('../services/wellbeing.service');
const supportService = require('../services/supportRequest.service');

const send = (res, { status, body }) => res.status(status).json(body);

async function createCheckin(req, res) {
  send(res, await wellbeingService.submitCheckin({ userId: req.auth.userId, body: req.body }));
}

async function instruments(req, res) {
  res.json(await wellbeingService.listInstruments({ query: req.query }));
}

async function createScreening(req, res) {
  send(res, await wellbeingService.submitScreening({ userId: req.auth.userId, body: req.body }));
}

async function createPvtRun(req, res) {
  send(res, await wellbeingService.submitPvtRun({ userId: req.auth.userId, body: req.body }));
}

async function createSupportRequest(req, res) {
  send(res, await supportService.createSupportRequest({ userId: req.auth.userId, body: req.body }));
}

async function supportMessages(req, res) {
  res.json(
    await supportService.crewMessages({
      userId: req.auth.userId,
      id: req.params.id,
      query: req.query,
    }),
  );
}

async function myWellbeing(req, res) {
  res.json(await wellbeingService.myHistory({ userId: req.auth.userId, query: req.query }));
}

module.exports = {
  createCheckin,
  instruments,
  createScreening,
  createPvtRun,
  createSupportRequest,
  supportMessages,
  myWellbeing,
};
