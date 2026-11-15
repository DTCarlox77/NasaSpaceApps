'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/sync.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = Router();

router.post('/push', authenticate(), requireRole('astronaut'), ctrl.push);

module.exports = router;
