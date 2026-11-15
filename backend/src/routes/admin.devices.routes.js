'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/devices.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

// Tabletas de las misiones (solo admin). La credencial se devuelve una sola vez, al registrar.
const router = Router();

router.use(authenticate(), requireRole('admin'));
router.get('/', ctrl.list);
router.post('/', ctrl.register);
router.post('/:id/revoke', ctrl.revoke);

module.exports = router;
