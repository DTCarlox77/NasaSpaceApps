'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/sync.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = Router();

router.post('/push', authenticate(), requireRole('astronaut'), ctrl.push);
router.get('/pull', authenticate(), requireRole('astronaut'), ctrl.pull);

module.exports = router;
