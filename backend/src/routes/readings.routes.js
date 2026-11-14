'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/readings.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = Router();
const astronaut = requireRole('astronaut');

router.post('/readings', authenticate(), astronaut, ctrl.create);
router.get('/me/readings', authenticate(), astronaut, ctrl.listMine);
router.get('/me/body-status', authenticate(), astronaut, ctrl.bodyStatus);

module.exports = router;
