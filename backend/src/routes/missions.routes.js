'use strict';

const { Router } = require('express');
const crewService = require('../services/crew.service');
const missionAdmin = require('../services/missionAdmin.service');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = Router();

router.get(
  '/missions/current',
  authenticate(),
  requireRole('astronaut', 'flight_surgeon', 'behavioral_health', 'admin'),
  async (req, res) => {
    res.json(await missionAdmin.currentMission({ userId: req.auth.userId, query: req.query }));
  },
);

router.get('/missions/:id/crew', authenticate(), async (req, res) => {
  res.json(
    await crewService.listMissionCrew({
      userId: req.auth.userId,
      missionId: req.params.id,
      query: req.query,
    }),
  );
});

module.exports = router;
