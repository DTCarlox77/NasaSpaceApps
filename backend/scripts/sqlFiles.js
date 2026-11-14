'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Devuelve los archivos .sql de un directorio ordenados por nombre
 * (por eso se numeran: 000_, 001_, ...).
 */
function listSqlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

function readSql(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

module.exports = { listSqlFiles, readSql };
