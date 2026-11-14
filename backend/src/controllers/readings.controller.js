'use strict';

const readingsService = require('../services/readings.service');
const { validate } = require('../utils/validate');
const { badRequest } = require('../utils/httpError');

const INPUT_METHODS = [
  'manual',
  'camera',
  'wearable',
  'sensor',
  'slider',
  'questionnaire',
  'minigame',
  'clicks',
];

async function create(req, res) {
  const body = validate(req.body)
    .uuid('client_uuid')
    .uuid('supersedes_uuid', { required: false })
    .string('indicator_code', { max: 40 })
    .string('measured_at', { max: 40 })
    .oneOf('input_method', INPUT_METHODS)
    .string('device_id', { required: false, max: 100 })
    .uuid('attachment_id', { required: false })
    .string('note', { required: false, max: 500 })
    .check();
  if (body.values === undefined) {
    throw badRequest([{ field: 'values', issue: 'es obligatorio' }]);
  }
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
