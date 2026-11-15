'use strict';

const { Router } = require('express');
const healthRoutes = require('./health.routes');
const authRoutes = require('./auth.routes');
const meRoutes = require('./me.routes');
const adminUsersRoutes = require('./admin.users.routes');
const catalogRoutes = require('./catalog.routes');
const readingsRoutes = require('./readings.routes');
const habitatRoutes = require('./habitat.routes');
const adminMissionRoutes = require('./admin.mission.routes');
const { restrictServiceAccounts } = require('../middlewares/auth');

const router = Router();

// Antes de todas las rutas: el rol service solo pasa a su lista blanca (también
// bloquea rutas que todavía no existen).
router.use(restrictServiceAccounts);

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/me', meRoutes);
router.use('/admin/users', adminUsersRoutes);
router.use(catalogRoutes);
router.use(readingsRoutes);
router.use(habitatRoutes);
router.use('/admin', adminMissionRoutes);

module.exports = router;
