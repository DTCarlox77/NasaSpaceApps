'use strict';
// Prueba de humo de la base de datos (después de `npm run db:reset`).
// Se salta sola si no hay .env o conexión a PostgreSQL. No usa src/config/env.js porque
// ese módulo termina el proceso si falta el .env; aquí la ausencia de base no es un error.
// Toma el advisory lock de las suites de BD para no correr durante un reset.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openTestDb, SKIP_REASON: SKIP } = require('./helpers/db');

const ORION_USER = '00000000-0000-4000-8000-000000000011';
const ORION = '10000000-0000-4000-8000-000000000011';
const ARES1 = '20000000-0000-4000-8000-000000000001';

let db = null;
let pool = null;

before(async () => {
  db = await openTestDb();
  if (db) pool = db.pool;
});

after(async () => {
  if (db) await db.close();
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
