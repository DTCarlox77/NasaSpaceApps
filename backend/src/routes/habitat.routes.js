'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/habitat.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = Router();

router.post(
  '/habitat/readings',
  authenticate(),
  requireRole('astronaut', 'service'),
  ctrl.createReadings,
);
router.get(
  '/habitat/status',
  authenticate(),
  requireRole('astronaut', 'flight_surgeon', 'admin'),
  ctrl.status,
);

module.exports = router;
