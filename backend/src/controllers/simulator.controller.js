'use strict';

const service = require('../services/simulator.service');

async function history(req, res) {
  res.json(await service.loadHistory({ body: req.body }));
}

async function scenario(req, res) {
  res.json(await service.runScenario({ name: req.params.name, body: req.body }));
}

module.exports = { history, scenario };
