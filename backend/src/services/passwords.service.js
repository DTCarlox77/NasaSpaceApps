'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { HttpError } = require('../utils/httpError');

// bcryptjs (JS puro): compatible con los hash $2a$10 del seed y sin módulos nativos.
const COST = 10;
const MIN_LENGTH = 10;
const MAX_BYTES = 72; // bcrypt ignora lo que pase de 72 bytes: se rechaza en vez de truncar.

// Hash de una contraseña cualquiera: se compara contra él cuando el usuario no
// existe, para que la respuesta tarde lo mismo y no revele qué falló.
const DUMMY_HASH = '$2a$10$qWUas2xzbAY8b45XyEZnCuFCs2w6bdgkViGcpFKgcKcgj605Pa7vi';

// Sin caracteres que se confunden al dictarlos (0/O, 1/l/I).
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

const hash = (password) => bcrypt.hash(password, COST);

const compare = (password, passwordHash) =>
  bcrypt.compare(String(password ?? ''), passwordHash || DUMMY_HASH);

/** Contraseña temporal aleatoria (se muestra una sola vez; solo se guarda su hash). */
function generateTemporary(length) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)];
  return out;
}

/** Política: mínimo 10 caracteres, máximo 72 bytes y distinta de la actual. */
function assertPolicy(newPassword, currentPassword) {
  const value = String(newPassword ?? '');
  const bytes = Buffer.byteLength(value, 'utf8');
  if (value.length < MIN_LENGTH || bytes > MAX_BYTES || value === currentPassword) {
    throw new HttpError(
      400,
      'WEAK_PASSWORD',
      'La contraseña debe tener al menos 10 caracteres y ser distinta de la actual.',
      { min_length: MIN_LENGTH, max_bytes: MAX_BYTES },
    );
  }
}

module.exports = { hash, compare, generateTemporary, assertPolicy, MIN_LENGTH };
