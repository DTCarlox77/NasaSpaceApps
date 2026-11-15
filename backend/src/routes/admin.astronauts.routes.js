'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/adminUsers.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = Router();

router.use(authenticate(), requireRole('admin'));
router.patch('/:id', ctrl.updateAstronaut);

module.exports = router;
