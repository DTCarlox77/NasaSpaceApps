'use strict';

const service = require('../services/missionAdmin.service');

const list = (fn) => async (req, res) => {
  res.json(await fn({ userId: req.auth.userId, query: req.query }));
};
const create = (fn) => async (req, res) => {
  res.status(201).json(await fn({ userId: req.auth.userId, body: req.body }));
};

module.exports = {
  listMissions: list(service.listMissions),
  createMission: create(service.createMission),
  async updateMission(req, res) {
    res.json(await service.updateMission({ id: req.params.id, body: req.body }));
  },
  listEnvironments: list(service.listEnvironments),
  createEnvironment: create(service.createEnvironment),
  async updateEnvironment(req, res) {
    res.json(await service.updateEnvironment({ code: req.params.code, body: req.body }));
  },
  listAssignments: list(service.listAssignments),
  createAssignment: create(service.createAssignment),
  async updateAssignment(req, res) {
    res.json(await service.updateAssignment({ id: req.params.id, body: req.body }));
  },
  listOutages: list(service.listOutages),
  createOutage: create(service.createOutage),
  async updateOutage(req, res) {
    res.json(await service.updateOutage({ id: req.params.id, body: req.body }));
  },
};
