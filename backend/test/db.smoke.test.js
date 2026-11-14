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

test('PHQ-2 y GAD-2: texto por idioma, licencia de Pfizer y solo 2 ítems', async (t) => {
  if (!pool) return t.skip(SKIP);
  const { rows } = await pool.query(
    'SELECT code, definition, license, sources FROM instruments WHERE is_active ORDER BY code',
  );
  assert.deepEqual(
    rows.map((r) => r.code),
    ['GAD2', 'PHQ2'],
  );
  for (const { code, definition: d, license, sources } of rows) {
    for (const text of [d, d.translations.en]) {
      assert.equal(text.items.length, 2, `${code}: solo los 2 ítems del cuestionario breve`);
      assert.deepEqual(
        text.options.map((o) => o.value),
        [0, 1, 2, 3],
      );
    }
    assert.equal(d.lang, 'es');
    assert.equal(d.translations.en.official, true, `${code} en es oficial (PHQ-4)`);
    assert.deepEqual(d.scoring, {
      method: 'sum',
      items: ['item_1', 'item_2'],
      min: 0,
      max: 6,
      cutoff: 3,
    });
    assert.match(license, /No permission required to reproduce, translate, display or distribute/);
    assert.doesNotMatch(license, /adaptaci|no oficial/i);
    // Los 4 textos son oficiales: es = Spanish for Mexico, en = English (PHQ-4).
    assert.equal(d.official, true, `${code} es oficial`);
    assert.equal(d.language_version, 'Spanish for Mexico');
    assert.equal(d.translations.en.language_version, 'English');
    assert.ok(
      sources.some((s) => s.url === d.source_url),
      `${code}: la URL del PDF en sources`,
    );
    // Nunca otros ítems: ni el 3–9 del PHQ-9 (el 9 es autolesión) ni el 3–7 del GAD-7.
    assert.doesNotMatch(JSON.stringify(d), /lastimarse|muerto|dormir|apetito|energía/i);
    assert.doesNotMatch(JSON.stringify(d), /demasiado|relajarse|inquieto|irritable|miedo/i);
  }
  const byCode = Object.fromEntries(rows.map((r) => [r.code, r.definition]));
  assert.match(byCode.PHQ2.source_url, /PHQ9_Spanish%20for%20Mexico\.pdf$/);
  assert.match(byCode.GAD2.source_url, /GAD7_Spanish%20for%20Mexico\.pdf$/);
  assert.equal(byCode.GAD2.options[0].label, 'Nunca', 'el GAD-2 usa las opciones del GAD-7');
});
