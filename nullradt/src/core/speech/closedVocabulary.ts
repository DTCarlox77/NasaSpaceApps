/**
 * Interpretación de voz SIN IA, por vocabulario cerrado: se compara lo dicho (normalizado: minúsculas,
 * sin acentos ni signos) con listas de sinónimos. Solo devuelve algo si hay UNA lectura sin ambigüedad;
 * si no, null (y la pantalla vuelve a preguntar o pasa a botones). Funciona igual sin conexión.
 */

/** minúsculas, sin acentos (á→a, ñ→n), sin signos; apóstrofos fuera ("don't" → "dont"). */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9.,\s-]/g, ' ')
    // El punto solo se queda entre cifras ("36.5"); "correcto." → "correcto".
    .replace(/\.(?=\D|$)/g, ' ')
    .replace(/(^|\D)\./g, '$1 ')
    .replace(/[-,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Hit<K extends string> {
  key: K;
  start: number;
  end: number;
}

/** Busca cada frase como palabras completas dentro del texto normalizado. */
function findHits<K extends string>(text: string, dictionary: Record<K, string[]>): Hit<K>[] {
  const padded = ` ${text} `;
  const hits: Hit<K>[] = [];
  for (const key of Object.keys(dictionary) as K[]) {
    for (const phrase of dictionary[key]) {
      const p = normalize(phrase);
      if (!p) continue;
      let from = 0;
      for (;;) {
        const i = padded.indexOf(` ${p} `, from);
        if (i < 0) break;
        hits.push({ key, start: i, end: i + p.length });
        from = i + 1;
      }
    }
  }
  // Una frase contenida en otra más larga de OTRA clave no cuenta ("dolor" dentro de "dolor de cabeza").
  return hits.filter(
    (h) => !hits.some((o) => o !== h && o.key !== h.key && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start),
  );
}

/** Claves distintas que aparecen en lo dicho (ya resueltas las frases contenidas en otras). */
export function matchKeys<K extends string>(text: string, dictionary: Record<K, string[]>): K[] {
  const keys: K[] = [];
  for (const h of findHits(normalize(text), dictionary)) if (!keys.includes(h.key)) keys.push(h.key);
  return keys;
}

/** Exactamente una clave; null si no hay ninguna o hay más de una (ambiguo). */
export function matchOne<K extends string>(text: string, dictionary: Record<K, string[]>): K | null {
  const keys = matchKeys(text, dictionary);
  return keys.length === 1 ? keys[0]! : null;
}

const UNITS_ES: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiuno: 21, veintiun: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100,
};
const UNITS_EN: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

/** Número dicho en cifra ("32", "36,5") o en palabras es/en ("treinta y dos", "thirty two"). null si no hay uno claro. */
export function parseSpokenNumber(text: string): number | null {
  const n = normalize(text);
  const digits = n.match(/-?\d+(?:[.]\d+)?/g) ?? [];
  // "36,5" → normalize cambió la coma por espacio: se reconstruye.
  const decimal = text.match(/-?\d+[.,]\d+/);
  if (decimal) return Number(decimal[0].replace(',', '.'));
  if (digits.length === 1) return Number(digits[0]);
  if (digits.length > 1) return null;
  let total = 0;
  let found = false;
  for (const w of n.split(' ')) {
    if (w === 'y' || w === 'and') continue;
    const v = UNITS_ES[w] ?? UNITS_EN[w];
    if (v === undefined) {
      if (found) break;
      continue;
    }
    if (v === 100 && found && total > 0 && total < 100) total *= 100;
    else total += v;
    found = true;
  }
  return found ? total : null;
}
