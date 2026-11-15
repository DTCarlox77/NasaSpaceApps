'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/ground.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = Router();
// Panel de Tierra (x-roles: flight_surgeon, admin). behavioral_health tiene su propia bandeja.
const ground = requireRole('flight_surgeon', 'admin');

router.get('/admin/dashboard/crew', authenticate(), ground, ctrl.crewDashboard);
router.get('/admin/inbox', authenticate(), ground, ctrl.inbox);
router.post('/admin/escalations/:id/ack', authenticate(), ground, ctrl.ack);
router.post('/admin/escalations/:id/messages', authenticate(), ground, ctrl.reply);
router.get('/admin/escalations/:id/messages', authenticate(), ground, ctrl.groundMessages);
router.get(
  '/escalations/:id/messages',
  authenticate(),
  requireRole('astronaut'),
  ctrl.crewMessages,
);

module.exports = router;
