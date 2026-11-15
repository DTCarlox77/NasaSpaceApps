'use strict';

const pushService = require('../services/syncPush.service');

async function push(req, res) {
  res.json(await pushService.push({ auth: req.auth, body: req.body }));
}

module.exports = { push };
