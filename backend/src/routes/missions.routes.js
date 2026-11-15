'use strict';

const { Router } = require('express');
const crewService = require('../services/crew.service');
const { authenticate } = require('../middlewares/auth');

const router = Router();

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
