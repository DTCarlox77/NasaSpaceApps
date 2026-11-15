'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/behavioral.controller');
const confidentialAudit = require('../services/confidentialAudit.service');
const { authenticate, requireRole } = require('../middlewares/auth');

// Salud conductual (solo behavioral_health) y cumplimiento (solo admin). Va antes del router
// de /admin (que exige admin a todo /admin/*).
const router = Router();
const bh = [authenticate(), requireRole('behavioral_health')];

router.get('/admin/behavioral/inbox', ...bh, ctrl.inbox);
router.get('/admin/behavioral/astronauts/:id', ...bh, ctrl.astronaut);
router.post('/admin/behavioral/support-requests/:id/messages', ...bh, ctrl.replySupport);
router.post('/admin/behavioral/support-requests/:id/ack', ...bh, ctrl.ackSupport);
router.post('/admin/behavioral/support-requests/:id/close', ...bh, ctrl.closeSupport);
router.post('/admin/behavioral/escalations/:id/ack', ...bh, ctrl.ackEscalation);
router.post('/admin/behavioral/escalations/:id/close', ...bh, ctrl.closeEscalation);
// Auditoría de accesos confidenciales: solo behavioral_health (admin no; tarea 11).
router.get('/admin/audit/confidential-access', ...bh, async (req, res) => {
  res.json(
    await confidentialAudit.forBehavioralHealth({ userId: req.auth.userId, query: req.query }),
  );
});
router.get('/admin/compliance', authenticate(), requireRole('admin'), ctrl.compliance);

module.exports = router;
