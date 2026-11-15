'use strict';
// Sin SIMULATOR_ENABLED=true los endpoints del simulador no existen: 404 antes de la
// autenticación (no revelan que existen). No toca la base.
require('./helpers/db'); // usa la configuración de pruebas antes de cargar src/
// Explícito: dotenv no pisa una variable ya definida, aunque el .env local diga true.
process.env.SIMULATOR_ENABLED = 'false';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');

test('simulador apagado: 404 en los dos endpoints, con o sin token', async () => {
  for (const url of [
    '/api/v1/admin/simulator/history',
    '/api/v1/admin/simulator/scenarios/co2_spike',
  ]) {
    const anonymous = await request(app).post(url).send({});
    assert.equal(anonymous.status, 404, url);
    assert.equal(anonymous.body.error.code, 'NOT_FOUND');
    const withToken = await request(app)
      .post(url)
      .set('Authorization', 'Bearer cualquier-token')
      .send({ days: 14 });
    assert.equal(withToken.status, 404, url);
  }
  // El resto de /admin sigue protegido como antes.
  assert.equal((await request(app).get('/api/v1/admin/missions')).status, 401);
});
