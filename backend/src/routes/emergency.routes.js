'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/emergency.controller');
const { authenticate, requireRole } = require('../middlewares/auth');

const router = Router();
const crew = [authenticate(), requireRole('astronaut')];
const anyone = [authenticate(), requireRole('astronaut', 'flight_surgeon', 'admin')];
const ground = [authenticate(), requireRole('flight_surgeon', 'admin')];

router.get('/emergency/protocol', ...anyone, ctrl.protocol);
router.post('/emergency/sessions', ...crew, ctrl.createSession);
router.get('/emergency/sessions/:id', ...anyone, ctrl.getSession);
router.post('/emergency/sessions/:id/assessments', ...crew, ctrl.createAssessment);
router.post('/emergency/sessions/:id/confirm', ...crew, ctrl.confirm);
router.post('/emergency/sessions/:id/heartbeat', ...crew, ctrl.heartbeat);
router.post('/emergency/sessions/:id/questions', ...crew, ctrl.question);
router.post('/emergency/sessions/:id/close', ...crew, ctrl.close);
router.put('/emergency/assessments/:id/answers', ...crew, ctrl.putAnswers);
router.post('/emergency/assessments/:id/complete', ...crew, ctrl.complete);
router.get('/admin/emergencies', ...ground, ctrl.groundList);
router.get('/admin/emergencies/:id', ...ground, ctrl.groundDetail);

module.exports = router;
