'use strict';

const habitatService = require('../services/habitat.service');

async function createReadings(req, res) {
  res.json(await habitatService.createHabitatReadings({ userId: req.auth.userId, body: req.body }));
}

async function status(req, res) {
  const moduleId = typeof req.query.module_id === 'string' ? req.query.module_id : undefined;
  const missionId = typeof req.query.mission_id === 'string' ? req.query.mission_id : undefined;
  res.json(await habitatService.habitatStatus({ userId: req.auth.userId, moduleId, missionId }));
}

module.exports = { createReadings, status };
