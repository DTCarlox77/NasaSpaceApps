'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/auth.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = Router();

router.get('/', authenticate(), ctrl.me);
// PIN de desbloqueo sin conexión del dispositivo de la sesión (tarea 11).
router.put('/offline-pin', authenticate(), requireRole('astronaut'), ctrl.setOfflinePin);

module.exports = router;
