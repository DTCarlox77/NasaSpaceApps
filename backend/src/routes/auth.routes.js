'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/auth.controller');
const { authenticate } = require('../middlewares/auth');
const { loginRateLimit } = require('../middlewares/authRateLimit');

const router = Router();

router.post('/login', loginRateLimit, ctrl.login);
router.post('/refresh', ctrl.refresh);
// Con el token del 428 (o con must_change_password) solo se pueden usar estas dos.
router.post('/change-password', authenticate({ allowPasswordChange: true }), ctrl.changePassword);
router.post('/logout', authenticate({ allowPasswordChange: true }), ctrl.logout);

module.exports = router;
