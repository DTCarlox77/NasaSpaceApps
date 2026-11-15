'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/crew.controller');
const { authenticate, requireRole, requireCrewRole } = require('../middlewares/auth');

// Permisos delegados del comandante (solo su misión vigente) y su auditoría para Tierra.
const router = Router();
const commander = [authenticate(), requireRole('astronaut'), requireCrewRole('commander')];

router.post('/crew/users/:id/unlock', ...commander, ctrl.unlockUser);
router.post('/crew/users/:id/reset-pin', ...commander, ctrl.resetPin);
router.post('/crew/devices', ...commander, ctrl.registerDevice);
// Pantalla "Tripulación" (a bordo). Quién ve qué lo decide canAccess (crew_status y
// crew_physical), no la ruta: Tierra y service reciben 403 desde ahí.
router.get('/crew/status', authenticate(), ctrl.status);
// Antes del router de /admin: auditoría de las acciones delegadas (solo admin).
router.get('/admin/audit/delegated-actions', authenticate(), requireRole('admin'), ctrl.audit);

module.exports = router;
