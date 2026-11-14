'use strict';

const { Router } = require('express');
const ctrl = require('../controllers/auth.controller');
const { authenticate } = require('../middlewares/auth');

const router = Router();

router.get('/', authenticate(), ctrl.me);

module.exports = router;
