'use strict';
// Rate limit en memoria (sin base de datos).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

test('429 al superar el máximo y se reinicia con la ventana', async (t) => {
  if (!process.env.PORT) return t.skip('sin .env (src/config/env.js lo exige)');
  const { createRateLimiter } = require('../src/middlewares/authRateLimit');
  let clock = 1000;
  const limiter = createRateLimiter({ windowMs: 60000, max: 2, now: () => clock });
  const headers = {};
  const res = { set: (k, v) => (headers[k] = v) };
  const req = { ip: '10.0.0.1' };
  let passed = 0;
  const next = () => (passed += 1);

  limiter(req, res, next);
  limiter(req, res, next);
  assert.equal(passed, 2);
  assert.throws(
    () => limiter(req, res, next),
    (err) =>
      err.status === 429 && err.code === 'RATE_LIMITED' && err.details.retry_after_seconds === 60,
  );
  assert.equal(headers['Retry-After'], '60');

  limiter({ ip: '10.0.0.2' }, res, next); // otra IP no comparte el contador
  assert.equal(passed, 3);

  clock += 60000; // nueva ventana
  limiter(req, res, next);
  assert.equal(passed, 4);
});
