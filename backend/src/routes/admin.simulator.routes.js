'use strict';

const { Router } = require('express');
const env = require('../config/env');
const ctrl = require('../controllers/simulator.controller');
const notFound = require('../middlewares/notFound');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = Router();

// Solo demo: sin SIMULATOR_ENABLED=true las rutas no existen (404, incluso sin sesión).
router.use((req, res, next) => (env.simulatorEnabled ? next() : notFound(req, res)));
router.use(authenticate(), requireRole('admin'));
router.post('/history', ctrl.history);
router.post('/scenarios/:name', ctrl.scenario);

module.exports = router;
