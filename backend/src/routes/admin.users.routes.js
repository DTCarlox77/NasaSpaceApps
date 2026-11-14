'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/adminUsers.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = Router();

router.use(authenticate(), requireRole('admin'));
router.post('/', ctrl.create);
router.post('/:id/reset-password', ctrl.resetPassword);
router.post('/:id/unlock', ctrl.unlock);

module.exports = router;
