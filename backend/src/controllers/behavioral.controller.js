'use strict';

const behavioralService = require('../services/behavioral.service');
const supportService = require('../services/supportRequest.service');

async function inbox(req, res) {
  res.json(await behavioralService.inbox({ userId: req.auth.userId, query: req.query, req }));
}

async function astronaut(req, res) {
  res.json(
    await behavioralService.astronautDetail({ userId: req.auth.userId, id: req.params.id, req }),
  );
}

async function replySupport(req, res) {
  res
    .status(201)
    .json(
      await supportService.reply({ userId: req.auth.userId, id: req.params.id, body: req.body }),
    );
}

async function ackSupport(req, res) {
  res.json(await supportService.acknowledge({ userId: req.auth.userId, id: req.params.id }));
}

async function closeSupport(req, res) {
  res.json(await supportService.close({ userId: req.auth.userId, id: req.params.id }));
}

async function ackEscalation(req, res) {
  res.json(
    await behavioralService.acknowledgeEscalation({ userId: req.auth.userId, id: req.params.id }),
  );
}

async function closeEscalation(req, res) {
  res.json(await behavioralService.closeEscalation({ userId: req.auth.userId, id: req.params.id }));
}

module.exports = {
  inbox,
  astronaut,
  replySupport,
  ackSupport,
  closeSupport,
  ackEscalation,
  closeEscalation,
};
