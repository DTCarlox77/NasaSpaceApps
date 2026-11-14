'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/catalog.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = Router();
const anyRole = requireRole('astronaut', 'flight_surgeon', 'behavioral_health', 'admin');

router.get('/indicators', authenticate(), anyRole, ctrl.listIndicators);
router.get('/indicators/:code', authenticate(), anyRole, ctrl.getIndicator);
router.get('/rules', authenticate(), anyRole, ctrl.getRules);
router.get('/body-zones', authenticate(), anyRole, ctrl.listBodyZones);
router.get('/symptoms', authenticate(), anyRole, ctrl.listSymptoms);

module.exports = router;
