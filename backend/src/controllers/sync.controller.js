'use strict';

const pushService = require('../services/syncPush.service');
const pullService = require('../services/syncPull.service');

async function push(req, res) {
  res.json(await pushService.push({ auth: req.auth, body: req.body }));
}

async function pull(req, res) {
  res.json(await pullService.pull({ auth: req.auth, query: req.query }));
}

module.exports = { push, pull };
