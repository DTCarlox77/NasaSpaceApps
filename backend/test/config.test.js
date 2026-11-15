'use strict';
// Configuración de despliegue (tarea 12), sin base de datos: JWT_SECRET y CORS_ORIGIN en
// producción, iteraciones del PIN, modo demo, CORS en la app, el gate del reinicio de demo,
// logs sin secretos y las negativas del CLI de demo:reset.
require('./helpers/db'); // configuración de pruebas antes de cargar src/ (no abre la base)
// Explícitos: dotenv no pisa variables ya definidas, aunque el .env local diga otra cosa.
process.env.CORS_ORIGIN = 'https://panel.example.com, http://localhost:8081/';
process.env.SIMULATOR_ENABLED = 'false';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Writable } = require('node:stream');
const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { loadEnv, ConfigError, DEV_JWT_SECRET } = require('../src/config/loadEnv');
const { describeError, safeUrl } = require('../src/utils/safeLog');
const { requestLogger } = require('../src/middlewares/requestLog');

const ROOT = path.join(__dirname, '..');
const STRONG = crypto.randomBytes(48).toString('base64url');
const PROD = {
  NODE_ENV: 'production',
  PORT: '3000',
  DATABASE_URL: 'postgres://usuario:clave@127.0.0.1:1/ninguna',
  CORS_ORIGIN: 'https://panel.example.com',
  JWT_SECRET: STRONG,
};

const configError = (vars) => {
  try {
    loadEnv(vars);
  } catch (err) {
    assert.ok(err instanceof ConfigError, err.message);
    return err.message;
  }
  return assert.fail('se esperaba ConfigError');
};

// ---------------------------------------------------------------- JWT_SECRET

test('producción: JWT_SECRET vacío, corto, de desarrollo, de ejemplo o débil → no arranca', () => {
  const weak = [
    '',
    'corto-pero-aleatorio-9f3k',
    DEV_JWT_SECRET,
    'changeme-changeme-changeme-changeme-123',
    'mi-super-secreto-para-produccion-2026-abc',
    'a'.repeat(48),
    '12121212121212121212121212121212121212',
  ];
  for (const value of weak) {
    const message = configError({ ...PROD, JWT_SECRET: value });
    assert.match(message, /JWT_SECRET/);
    if (value) assert.ok(!message.includes(value), 'el mensaje no repite el secreto');
  }
  assert.equal(loadEnv(PROD).auth.jwtSecret, STRONG);
});

test('development/test: sin JWT_SECRET usa el de desarrollo', () => {
  const env = loadEnv({ ...PROD, NODE_ENV: 'development', JWT_SECRET: '' });
  assert.equal(env.auth.jwtSecret, DEV_JWT_SECRET);
});

test('el servidor no arranca en producción con el JWT por defecto (proceso real)', () => {
  for (const jwt of [DEV_JWT_SECRET, '']) {
    const run = spawnSync(process.execPath, ['src/server.js'], {
      cwd: ROOT,
      env: { ...process.env, ...PROD, JWT_SECRET: jwt, TRIAGE_SWEEP_INTERVAL_S: '0' },
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(run.status, 1, `debe salir con 1 (salida: ${run.stderr})`);
    assert.match(run.stderr, /\[env\] JWT_SECRET/);
    assert.ok(!run.stdout.includes('Escuchando'), 'no llegó a escuchar');
    if (jwt) assert.ok(!run.stderr.includes(jwt), 'no imprime el secreto');
  }
});

// ---------------------------------------------------------------- CORS_ORIGIN

test('producción: CORS_ORIGIN "*" o vacío → no arranca; orígenes inválidos → no arranca', () => {
  assert.match(configError({ ...PROD, CORS_ORIGIN: '*' }), /CORS_ORIGIN no puede ser "\*"/);
  assert.match(configError({ ...PROD, CORS_ORIGIN: '' }), /CORS_ORIGIN/);
  for (const bad of ['localhost:5173', 'https://panel.example.com/app', 'https://a.com,*']) {
    assert.match(configError({ ...PROD, CORS_ORIGIN: bad }), /no son un origen/, bad);
  }
  const env = loadEnv({
    ...PROD,
    CORS_ORIGIN: 'https://Panel.Example.com/, http://localhost:8081,https://panel.example.com',
  });
  assert.deepEqual(env.corsOrigin, ['https://panel.example.com', 'http://localhost:8081']);
  assert.equal(loadEnv({ ...PROD, NODE_ENV: 'development', CORS_ORIGIN: '*' }).corsOrigin, '*');
});

test('CORS: un origen no permitido no recibe Access-Control-Allow-Origin', async () => {
  const app = require('../src/app');
  const allowed = await request(app)
    .options('/api/v1/auth/login')
    .set('Origin', 'https://panel.example.com')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type,authorization');
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://panel.example.com');

  const expo = await request(app).get('/api/v1/no-existe').set('Origin', 'http://localhost:8081');
  assert.equal(expo.headers['access-control-allow-origin'], 'http://localhost:8081');

  for (const origin of ['https://evil.example.com', 'http://localhost:5173', 'null']) {
    const preflight = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST');
    assert.equal(preflight.headers['access-control-allow-origin'], undefined, origin);
    const get = await request(app).get('/api/v1/no-existe').set('Origin', origin);
    assert.equal(get.status, 404);
    assert.equal(get.headers['access-control-allow-origin'], undefined, origin);
  }
  // App nativa: sin Origin, la API responde igual (CORS no aplica).
  const native = await request(app).get('/api/v1/no-existe');
  assert.equal(native.status, 404);
});

// ---------------------------------------------------------------- PIN, modo demo

test('OFFLINE_PIN_PBKDF2_ITERATIONS: 600 000 por defecto, configurable, mínimo 10 000', () => {
  assert.equal(loadEnv(PROD).auth.offlinePinIterations, 600000);
  assert.equal(
    loadEnv({ ...PROD, OFFLINE_PIN_PBKDF2_ITERATIONS: '120000' }).auth.offlinePinIterations,
    120000,
  );
  assert.match(
    configError({ ...PROD, OFFLINE_PIN_PBKDF2_ITERATIONS: '1000' }),
    /OFFLINE_PIN_PBKDF2_ITERATIONS debe ser un entero >= 10000/,
  );
});

test('modo demo: simulador encendido y, en producción, además DEMO_SEED=true', () => {
  const mode = (vars) => loadEnv({ ...PROD, ...vars }).demoMode;
  assert.equal(mode({ SIMULATOR_ENABLED: 'true', DEMO_SEED: 'false' }), false);
  assert.equal(mode({ SIMULATOR_ENABLED: 'false', DEMO_SEED: 'true' }), false);
  assert.equal(mode({ SIMULATOR_ENABLED: 'true', DEMO_SEED: 'true' }), true);
  assert.equal(mode({ NODE_ENV: 'development', SIMULATOR_ENABLED: 'true' }), true);
  assert.equal(mode({ NODE_ENV: 'development' }), false);
});

test('reinicio de demo fuera del modo demo: 404, con o sin token', async () => {
  const app = require('../src/app');
  const anonymous = await request(app).post('/api/v1/admin/demo/reset').send({ confirm: 'ARES-1' });
  assert.equal(anonymous.status, 404);
  assert.equal(anonymous.body.error.code, 'NOT_FOUND');
  const withToken = await request(app)
    .post('/api/v1/admin/demo/reset')
    .set('Authorization', 'Bearer cualquier-token')
    .send({ confirm: 'ARES-1' });
  assert.equal(withToken.status, 404);
});

// ---------------------------------------------------------------- logs

test('logs: los errores no llevan el detalle de PostgreSQL, tokens ni valores', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJh';
  const pg = Object.assign(
    new Error('new row for relation "readings" violates check constraint "readings_value_ck"'),
    {
      code: '23514',
      constraint: 'readings_value_ck',
      table: 'readings',
      detail: 'Failing row contains (…, {"value": 39.6}, …).',
      where: 'SQL statement',
    },
  );
  const out = describeError(pg);
  assert.match(out, /readings_value_ck/);
  assert.match(out, /code=23514/);
  assert.ok(!out.includes('39.6') && !out.includes('Failing row'), out);

  const cases = [
    new Error(`invalid input syntax for type uuid: "${jwt}"`),
    new Error('value "987654321987" is out of range for type integer'),
    new Error(`Unexpected token 'p', "pin=1234" is not valid JSON`),
    new Error(`fallo con Authorization: Bearer ${jwt}`),
    new Error('credencial dc_demo_tab1_sintetica y refresh rt_abcdefghijklmnopqrstuvwxyz'),
  ];
  for (const err of cases) {
    const line = describeError(err);
    for (const secret of [jwt, '987654321987', 'pin=1234', 'dc_demo_tab1', 'rt_abcdefghij']) {
      assert.ok(!line.includes(secret), line);
    }
  }
});

test('logs: el errorHandler registra la ruta sin la query ni el error crudo', () => {
  const errorHandler = require('../src/middlewares/errorHandler');
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(' '));
  try {
    const res = { status: () => res, json: () => res };
    const err = Object.assign(new Error('boom'), { detail: 'Failing row contains (SpO2 88)' });
    errorHandler(err, { method: 'GET', originalUrl: '/api/v1/sync/pull?cursor=SECRETO' }, res);
  } finally {
    console.error = original;
  }
  const text = lines.join('\n');
  assert.match(text, /\[error\] GET \/api\/v1\/sync\/pull\?cursor=… → Error: boom/);
  assert.ok(!text.includes('SECRETO') && !text.includes('SpO2 88'), text);
});

test('logs: las peticiones salen sin headers, body ni valores de la query', async () => {
  let out = '';
  const stream = new Writable({
    write(chunk, _enc, done) {
      out += chunk.toString();
      done();
    },
  });
  const app = express();
  app.use(express.json());
  app.use(requestLogger({ stream }));
  app.post('/api/v1/auth/login', (req, res) => res.status(200).json({ ok: true }));
  await request(app)
    .post('/api/v1/auth/login?token=eyJsecreto&device=TAB-1')
    .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')
    .set('X-Device-Credential', 'dc_demo_tab1_sintetica')
    .send({ username: 'a.ortega', password: 'Demo2026!', pin: '1234' });
  assert.match(out, /POST \/api\/v1\/auth\/login\?token=…&device=… 200/);
  for (const secret of ['eyJ', 'Demo2026!', 'dc_demo', '1234', 'a.ortega', 'TAB-1']) {
    assert.ok(!out.includes(secret), `${secret} en: ${out}`);
  }
  assert.equal(safeUrl('/api/v1/health'), '/api/v1/health');
});

// ---------------------------------------------------------------- CLI de demo:reset

test('npm run demo:reset se niega sin confirmación, con NODE_ENV=test o fuera del modo demo', () => {
  const run = (args, vars = {}) =>
    spawnSync(process.execPath, ['scripts/demoReset.js', ...args], {
      cwd: ROOT,
      // Nunca la base de desarrollo, aunque llegara a conectar (no debe: se niega antes).
      env: { ...process.env, DB_NAME: process.env.DB_NAME, ...vars },
      encoding: 'utf8',
      timeout: 15000,
    });
  const noConfirm = run([]);
  assert.equal(noConfirm.status, 1);
  assert.match(noConfirm.stderr, /Falta la confirmación/);
  const wrong = run(['--confirm', 'ARES-2']);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /Falta la confirmación/);
  const inTests = run(['--confirm', 'ARES-1'], { NODE_ENV: 'test' });
  assert.equal(inTests.status, 1);
  assert.match(inTests.stderr, /NODE_ENV=test/);
  const notDemo = run(['--confirm', 'ARES-1'], {
    ...PROD,
    SIMULATOR_ENABLED: 'true',
    DEMO_SEED: 'false',
  });
  assert.equal(notDemo.status, 1);
  assert.match(notDemo.stderr, /modo demo/);
});
