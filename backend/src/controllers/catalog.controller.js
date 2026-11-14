'use strict';

const catalog = require('../services/catalog.service');
const { badRequest, notFound } = require('../utils/httpError');

const SENSITIVITIES = ['standard', 'confidential'];

async function listIndicators(req, res) {
  const { body_zone: bodyZone, sensitivity } = req.query;
  if (sensitivity !== undefined && !SENSITIVITIES.includes(sensitivity)) {
    throw badRequest([{ field: 'sensitivity', issue: 'debe ser standard o confidential' }]);
  }
  res.json(await catalog.listIndicators({ bodyZone, sensitivity }));
}

async function getIndicator(req, res) {
  const indicator = await catalog.getIndicator(req.params.code);
  if (!indicator) throw notFound(`El indicador ${req.params.code} no existe.`);
  res.json(indicator);
}

async function getRules(req, res) {
  let since;
  if (req.query.since_version !== undefined) {
    since = Number(req.query.since_version);
    if (!Number.isInteger(since) || since < 0) {
      throw badRequest([{ field: 'since_version', issue: 'debe ser un entero >= 0' }]);
    }
  }
  res.json(await catalog.rulesSince(since));
}

async function listBodyZones(_req, res) {
  res.json(await catalog.bodyZones());
}

async function listSymptoms(_req, res) {
  res.json(await catalog.symptoms());
}

module.exports = { listIndicators, getIndicator, getRules, listBodyZones, listSymptoms };
