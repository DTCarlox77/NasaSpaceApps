'use strict';
// Prueba de humo de la base de datos, sobre la base de PRUEBAS (DB_NAME_TEST) recién
// reiniciada (migraciones + seeds). Se salta sola si no hay .env o base de pruebas.
// Toma el advisory lock de las suites de BD para no correr durante el reset de otra.
const { openTestDb, resetDatabase } = require('./helpers/db'); // antes que cualquier src/
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const ORION_USER = '00000000-0000-4000-8000-000000000011';
const ORION = '10000000-0000-4000-8000-000000000011';
const ARES1 = '20000000-0000-4000-8000-000000000001';

let db = null;
let pool = null;
let SKIP = '';

before(async () => {
  const opened = await openTestDb();
  db = opened.db;
  SKIP = opened.reason;
  if (!db) return;
  await resetDatabase();
  pool = db.pool;
});

after(async () => {
  if (!db) return;
  await require('../src/config/db').pool.end();
  await db.close();
});

const one = async (sql) => (await pool.query(sql)).rows[0];

// Ejecuta fn dentro de una transacción que siempre se revierte (no deja datos).
async function inRollback(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

test('conteos del seed: tripulación vigente, indicadores y reglas activas', async (t) => {
  if (!pool) return t.skip(SKIP);
  assert.equal((await one('SELECT count(*)::int AS n FROM v_current_crew')).n, 4);
  assert.equal((await one('SELECT count(*)::int AS n FROM indicators')).n, 26);
  assert.equal(
    (await one('SELECT count(*)::int AS n FROM indicator_rule_versions WHERE is_active')).n,
    26,
  );
});

test('el índice único de client_uuid rechaza una lectura duplicada del mismo autor', async (t) => {
  if (!pool) return t.skip(SKIP);
  await inRollback(async (c) => {
    const insertReading = () =>
      c.query(
        `INSERT INTO readings (client_uuid, recorded_by, mission_id, astronaut_id, indicator_code,
                               components, source, measured_at)
         VALUES ('c1000000-0000-4000-8000-0000000000aa', $1, $2, $3, 'HEART_RATE',
                 '{"value": 72}', 'wearable', now())`,
        [ORION_USER, ARES1, ORION],
      );
    await insertReading();
    await assert.rejects(insertReading, (err) => {
      assert.equal(err.code, '23505'); // unique_violation
      assert.equal(err.constraint, 'readings_author_uq');
      return true;
    });
  });
});

test('las lecturas son append-only', async (t) => {
  if (!pool) return t.skip(SKIP);
  await inRollback(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO readings (client_uuid, recorded_by, mission_id, astronaut_id, indicator_code,
                             components, source, measured_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'SPO2', '{"value": 97}', 'manual', now())
       RETURNING id`,
      [ORION_USER, ARES1, ORION],
    );
    await assert.rejects(
      c.query(`UPDATE readings SET note = 'x' WHERE id = $1`, [rows[0].id]),
      /append-only/,
    );
  });
});

test('no puede haber dos versiones activas de reglas para un indicador', async (t) => {
  if (!pool) return t.skip(SKIP);
  await inRollback(async (c) => {
    await assert.rejects(
      c.query(
        `INSERT INTO indicator_rule_versions (indicator_code, version, rules, is_active)
         SELECT indicator_code, version + 1, rules, true
         FROM indicator_rule_versions WHERE indicator_code = 'SPO2' AND is_active`,
      ),
      (err) => {
        assert.equal(err.code, '23505');
        assert.equal(err.constraint, 'indicator_rules_one_active_uq');
        return true;
      },
    );
  });
});
