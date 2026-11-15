'use strict';

const { Router } = require('express');
const healthRoutes = require('./health.routes');
const authRoutes = require('./auth.routes');
const meRoutes = require('./me.routes');
const adminUsersRoutes = require('./admin.users.routes');
const adminAstronautsRoutes = require('./admin.astronauts.routes');
const catalogRoutes = require('./catalog.routes');
const readingsRoutes = require('./readings.routes');
const habitatRoutes = require('./habitat.routes');
const groundRoutes = require('./ground.routes');
const missionsRoutes = require('./missions.routes');
const adminMissionRoutes = require('./admin.mission.routes');
const adminSimulatorRoutes = require('./admin.simulator.routes');
const { restrictServiceAccounts } = require('../middlewares/auth');

const router = Router();

// Antes de todas las rutas: el rol service solo pasa a su lista blanca (también
// bloquea rutas que todavía no existen).
router.use(restrictServiceAccounts);

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/me', meRoutes);
router.use('/admin/users', adminUsersRoutes);
router.use('/admin/astronauts', adminAstronautsRoutes);
router.use(catalogRoutes);
router.use(readingsRoutes);
router.use(habitatRoutes);
router.use(groundRoutes);
router.use(missionsRoutes);
// Antes de /admin: su router exige admin a todo /admin/* y el simulador apagado debe dar 404.
router.use('/admin/simulator', adminSimulatorRoutes);
router.use('/admin', adminMissionRoutes);

module.exports = router;
