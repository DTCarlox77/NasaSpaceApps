'use strict';
// Acceso (tarea 11), funciones puras: mapa de capacidades del comandante, formato y hash de la
// credencial de tableta, parámetros del verificador del PIN y su formato. Sin base.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { COMMANDER_CAPABILITIES, can } = require('../src/services/delegation.service');
const { generateCredential, hashCredential } = require('../src/services/devices.service');
const { offlineVerifier, PIN_RE } = require('../src/services/offlinePin.service');

test('comandante: solo tres capacidades de acceso; ninguna de datos de salud', () => {
  assert.deepEqual(Object.keys(COMMANDER_CAPABILITIES).sort(), [
    'register_device',
    'reset_offline_pin',
    'unlock_user',
  ]);
  for (const action of Object.keys(COMMANDER_CAPABILITIES)) {
    assert.equal(can('commander', action), true, action);
    for (const role of ['crew_medical_officer', 'pilot', 'flight_engineer', null]) {
      assert.equal(can(role, action), false, `${role} ${action}`);
    }
  }
  for (const action of ['read_readings', 'read_wellbeing', 'read_support_requests', 'toString']) {
    assert.equal(can('commander', action), false, action);
  }
});

test('credencial de tableta: aleatoria, 46 caracteres, y en la base solo su SHA-256', () => {
  const a = generateCredential();
  const b = generateCredential();
  assert.match(a, /^dc_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.match(hashCredential(a), /^[0-9a-f]{64}$/);
  // Igual que el seed: encode(sha256(convert_to('dc_demo_tab1_sintetica', 'UTF8')), 'hex').
  assert.equal(
    hashCredential('dc_demo_tab1_sintetica'),
    crypto.createHash('sha256').update('dc_demo_tab1_sintetica').digest('hex'),
  );
});

test('PIN: 4 a 8 dígitos; verificador local PBKDF2 con el máximo de intentos de LOCKOUT_*', () => {
  for (const ok of ['1234', '48291537']) assert.ok(PIN_RE.test(ok), ok);
  for (const bad of ['123', '123456789', '12a4', ' 1234']) assert.ok(!PIN_RE.test(bad), bad);
  const v = offlineVerifier();
  assert.equal(v.kdf, 'PBKDF2-HMAC-SHA256');
  assert.ok(v.iterations >= 600000);
  assert.equal(v.salt_bytes, 16);
  assert.equal(v.max_attempts, Number(process.env.LOCKOUT_MAX_ATTEMPTS || 5));
});
