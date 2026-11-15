/**
 * Intérprete de comandos de voz (función pura, sin React ni red: funciona sin conexión).
 * - Normaliza lo que entendió el reconocedor (minúsculas, sin tildes ni signos).
 * - Detecta la palabra de activación "NullRadt" y sus transcripciones habituales.
 * - Extrae números dichos con palabras o cifras (para el check-in por voz).
 */

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Cómo suele transcribir el reconocedor "NullRadt" (es/en): "null rad", "nul rad", "nulrad", "null rat",
 * "nool rad", "null radt", "nolrad", "full rad"… Se aceptan con o sin "oye"/"hey" delante.
 */
const WAKE = /\b(?:oye\s+|hey\s+|ok\s+)?(?:n[ou]{1,2}l{1,2}\s?r[ae]d[st]?|n[ou]{1,2}l{1,2}\s?rat[st]?|nul{1,2}\s?radt|full\s?rad|null\s?red|nulra[dt])\b/;

export function detectWake(text: string): { woke: boolean; rest: string } {
  const n = normalize(text);
  const m = WAKE.exec(n);
  if (!m) return { woke: false, rest: n };
  return { woke: true, rest: n.slice(m.index + m[0].length).trim() };
}

const NUMBER_WORDS: Record<string, number> = {
  cero: 0, zero: 0, uno: 1, una: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, for: 4,
  cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10,
};

/** Primer número 0–10 en la frase ("siete", "un 7", "7 de 10" → 7). null si no hay. */
export function parseScore(text: string): number | null {
  const n = normalize(text);
  const digit = /\b(10|[0-9])\b/.exec(n);
  if (digit) return Number(digit[1]);
  for (const w of n.split(' ')) if (w in NUMBER_WORDS) return NUMBER_WORDS[w]!;
  return null;
}

export const isYes = (text: string) => /\b(si|claro|correcto|afirmativo|vale|ok|yes|yeah|sure|correct)\b/.test(normalize(text));
export const isNo = (text: string) => /\b(no|negativo|nope|cancel|cancela|cancelar)\b/.test(normalize(text));
