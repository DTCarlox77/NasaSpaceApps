'use strict';

const env = require('../config/env');
const service = require('../services/demoReset.service');

async function reset(req, res) {
  if (env.nodeEnv !== 'test') {
    console.log(`[demo] reinicio de demo pedido por ${req.auth.username}`);
  }
  res.json(await service.resetDemo({ body: req.body, actorUserId: req.auth.userId, ip: req.ip }));
}

module.exports = { reset };
