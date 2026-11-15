'use strict';

const { Router } = require('express');
const env = require('../config/env');
const ctrl = require('../controllers/demo.controller');
const notFound = require('../middlewares/notFound');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = Router();

// Solo demo, igual que el simulador: fuera del modo demo (SIMULATOR_ENABLED=true y, fuera de
// development/test, DEMO_SEED=true) la ruta no existe (404, incluso sin sesión).
router.use((req, res, next) => (env.demoMode ? next() : notFound(req, res)));
router.use(authenticate(), requireRole('admin'));
router.post('/reset', ctrl.reset);

module.exports = router;
