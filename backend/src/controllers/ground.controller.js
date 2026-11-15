'use strict';

const inboxService = require('../services/escalationInbox.service');

async function inbox(req, res) {
  res.json(await inboxService.inbox({ userId: req.auth.userId, query: req.query }));
}

async function ack(req, res) {
  res.json(await inboxService.acknowledge({ userId: req.auth.userId, id: req.params.id }));
}

async function reply(req, res) {
  res
    .status(201)
    .json(await inboxService.reply({ userId: req.auth.userId, id: req.params.id, body: req.body }));
}

async function crewMessages(req, res) {
  res.json(
    await inboxService.crewMessages({
      userId: req.auth.userId,
      id: req.params.id,
      query: req.query,
    }),
  );
}

module.exports = { inbox, ack, reply, crewMessages };
