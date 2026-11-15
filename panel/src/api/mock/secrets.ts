/**
 * Contraseñas del modo demo: nunca en texto plano en localStorage. Se guarda SHA-256 de
 * `${id de usuario}:${contraseña}` (crypto.subtle: necesita https o localhost).
 * La contraseña temporal se genera con crypto.getRandomValues, con la forma del contrato
 * (p. ej. "Temp-4821-kx"), y solo viaja en la respuesta que la muestra una vez.
 */

export class InsecureContextError extends Error {
  constructor() {
    super('El modo demo necesita https o localhost para guardar contraseñas (crypto.subtle).');
    this.name = 'InsecureContextError';
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new InsecureContextError();
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const passwordHash = (userId: string, password: string): Promise<string> =>
  sha256Hex(`${userId}:${password}`);

const LETTERS = 'abcdefghjkmnpqrstuvwxyz';

export function generateTemporaryPassword(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  const digits = [...bytes.slice(0, 4)].map((b) => String(b % 10)).join('');
  const letters = [...bytes.slice(4)].map((b) => LETTERS[b % LETTERS.length]).join('');
  return `Temp-${digits}-${letters}`;
}

/** Valor de `password_hash` mientras se calcula el hash (no coincide con ninguna contraseña). */
export const HASH_PENDING = 'pendiente';
