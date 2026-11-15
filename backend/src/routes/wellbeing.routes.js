'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/wellbeing.controller');
const confidentialAudit = require('../services/confidentialAudit.service');
const { authenticate, requireRole } = require('../middlewares/auth');

// Bienestar del astronauta (confidencial): solo él registra y ve lo suyo.
const router = Router();
const astronaut = [authenticate(), requireRole('astronaut')];

router.post('/wellbeing/checkins', ...astronaut, ctrl.createCheckin);
router.get(
  '/wellbeing/instruments',
  authenticate(),
  requireRole('astronaut', 'behavioral_health'),
  ctrl.instruments,
);
router.post('/wellbeing/screenings', ...astronaut, ctrl.createScreening);
router.post('/wellbeing/pvt-runs', ...astronaut, ctrl.createPvtRun);
router.post('/wellbeing/support-requests', ...astronaut, ctrl.createSupportRequest);
router.get('/wellbeing/support-requests/:id/messages', ...astronaut, ctrl.supportMessages);
router.get('/me/wellbeing', ...astronaut, ctrl.myWellbeing);
// Quién consultó mis datos confidenciales y cuándo (tarea 11).
router.get('/me/confidential-access', ...astronaut, async (req, res) => {
  res.json(await confidentialAudit.forOwner({ userId: req.auth.userId, query: req.query }));
});

module.exports = router;
