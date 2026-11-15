#!/usr/bin/env node
/**
 * Actualiza el motor compartido y el protocolo de respaldo desde la rama del backend
 * (sin dependencias; Node 18+ y git). NO reescribe nada a mano: copia los archivos TAL CUAL.
 *
 *   git fetch origin backend
 *   node scripts/sync-engine.mjs                # desde origin/backend
 *   node scripts/sync-engine.mjs --ref <commit> # desde otro commit o rama
 *
 * Qué hace:
 *   1. backend/src/engine/conditions.js → src/core/engine/conditions.js
 *   2. backend/src/engine/triage.js     → src/core/engine/triage.js
 *   3. backend/db/seeds/004_protocolo_triaje_v2.sql → src/data/datasources/local/fallback/triage-protocol-v2.json
 *      (los bloques $json$ del seed, igual que los extraen las pruebas del backend), marcado como
 *      COPIA DE RESPALDO: la app solo la usa si nunca pudo descargar GET /emergency/protocol.
 * Después: anota el commit que imprime en INTEGRACION.md (§11) y corre `node scripts/triage-parity.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argRef = process.argv.indexOf('--ref');
const REF = argRef > -1 ? process.argv[argRef + 1] : 'origin/backend';

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const show = (path) => git('show', `${REF}:${path}`);

const commit = git('rev-parse', '--short', REF).trim();

for (const name of ['conditions.js', 'triage.js']) {
  writeFileSync(join(ROOT, 'src', 'core', 'engine', name), show(`backend/src/engine/${name}`));
  console.log(`✓ src/core/engine/${name}  ←  ${REF} (${commit}):backend/src/engine/${name}`);
}

const SEED = 'backend/db/seeds/004_protocolo_triaje_v2.sql';
const sql = show(SEED);
const blocks = [...sql.matchAll(/\$json\$([\s\S]*?)\$json\$/g)].map((m) => JSON.parse(m[1]));
const definition = blocks.find((b) => b && !Array.isArray(b) && Array.isArray(b.questions));
const sources = blocks.find(Array.isArray);
const name = /'crew_emergency',\s*2,\s*'([^']+)'/.exec(sql)?.[1];
if (!definition || !sources || !name) throw new Error(`No se encontró el protocolo v2 en ${SEED}`);

const fallback = {
  _note:
    'COPIA DE RESPALDO del protocolo v2 del seed del backend. Solo se usa en un primer arranque sin red; ' +
    'en cuanto hay conexión manda GET /emergency/protocol. No editar a mano: node scripts/sync-engine.mjs.',
  fallback: true,
  copied_from: { ref: REF, commit, file: SEED },
  code: 'crew_emergency',
  version: 2,
  name,
  sources,
  definition,
};
const out = join(ROOT, 'src', 'data', 'datasources', 'local', 'fallback', 'triage-protocol-v2.json');
writeFileSync(out, `${JSON.stringify(fallback, null, 2)}\n`);
console.log(`✓ src/data/datasources/local/fallback/triage-protocol-v2.json  ←  ${SEED}`);
console.log(`\nCommit del backend: ${commit}. Anótalo en INTEGRACION.md y corre: node scripts/triage-parity.mjs`);
