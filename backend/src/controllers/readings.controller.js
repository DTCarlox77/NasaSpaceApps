'use strict';

const readingsService = require('../services/readings.service');

async function create(req, res) {
  const body = readingsService.validateReadingBody(req.body);
  const { status, body: result } = await readingsService.createReading({
    userId: req.auth.userId,
    input: body,
  });
  res.status(status).json(result);
}

async function listMine(req, res) {
  res.json(await readingsService.listMyReadings({ userId: req.auth.userId, query: req.query }));
}

async function bodyStatus(req, res) {
  const moduleId = typeof req.query.module_id === 'string' ? req.query.module_id : undefined;
  res.json(await readingsService.bodyStatus({ userId: req.auth.userId, moduleId }));
}

module.exports = { create, listMine, bodyStatus };
