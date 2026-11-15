'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/mission.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = Router();

router.use(authenticate(), requireRole('admin'));
router.get('/missions', ctrl.listMissions);
router.post('/missions', ctrl.createMission);
router.patch('/missions/:id', ctrl.updateMission);
router.get('/environments', ctrl.listEnvironments);
router.post('/environments', ctrl.createEnvironment);
router.patch('/environments/:code', ctrl.updateEnvironment);
router.get('/assignments', ctrl.listAssignments);
router.post('/assignments', ctrl.createAssignment);
router.patch('/assignments/:id', ctrl.updateAssignment);
router.get('/comm-outages', ctrl.listOutages);
router.post('/comm-outages', ctrl.createOutage);
router.patch('/comm-outages/:id', ctrl.updateOutage);

module.exports = router;
