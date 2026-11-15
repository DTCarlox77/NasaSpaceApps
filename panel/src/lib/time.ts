/**
 * Tiempo y retraso para el panel. Todas las funciones reciben `now` (ms) para poder probarlas
 * y para que las pantallas las recalculen con useNow().
 * - El backend manda ISO 8601 en UTC; el panel muestra hora local (hh:mm, 24 h).
 * - El retraso Tierra–nave es de minutos (ARES-1: 90 s acelerado en la demo).
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const toMs = (iso: string): number => new Date(iso).getTime();

const clockFormat = new Intl.DateTimeFormat('es', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const dateClockFormat = new Intl.DateTimeFormat('es', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** hh:mm en hora local. Cadena vacía si la fecha no es válida. */
export function clockTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = toMs(iso);
  return Number.isNaN(ms) ? '' : clockFormat.format(ms);
}

/** dd/mm hh:mm en hora local (para ejes y tablas con varios días). */
export function dateClock(iso: string): string {
  const ms = toMs(iso);
  return Number.isNaN(ms) ? '' : dateClockFormat.format(ms).replace(',', '');
}

/**
 * Duración legible: "45 s", "1 min 30 s", "2 h 5 min", "3 d 4 h". Dos unidades como máximo;
 * la segunda se omite si es cero.
 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < MINUTE) return `${s} s`;
  const pair = (big: number, bigUnit: string, small: number, smallUnit: string) =>
    small > 0 ? `${big} ${bigUnit} ${small} ${smallUnit}` : `${big} ${bigUnit}`;
  if (s < HOUR) return pair(Math.floor(s / MINUTE), 'min', s % MINUTE, 's');
  if (s < DAY) return pair(Math.floor(s / HOUR), 'h', Math.floor((s % HOUR) / MINUTE), 'min');
  return pair(Math.floor(s / DAY), 'd', Math.floor((s % DAY) / HOUR), 'h');
}

/**
 * "hace X" relativo a `now`: "hace un momento" (< 45 s), "hace 5 min", "hace 2 h", "hace 3 d".
 * Una fecha futura (reloj desfasado) → "en X".
 */
export function timeAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return '';
  const ms = toMs(iso);
  if (Number.isNaN(ms)) return '';
  const diff = Math.round((now - ms) / 1000);
  if (Math.abs(diff) < 45) return 'hace un momento';
  const abs = Math.abs(diff);
  const amount =
    abs < HOUR
      ? `${Math.round(abs / MINUTE)} min`
      : abs < DAY
        ? `${Math.floor(abs / HOUR)} h`
        : `${Math.floor(abs / DAY)} d`;
  return diff > 0 ? `hace ${amount}` : `en ${amount}`;
}

/** Retraso entre la medición y la recepción (`lag_s`): "llegó 1 min 30 s después". */
export function lagLabel(lagSeconds: number | null | undefined): string {
  if (lagSeconds === null || lagSeconds === undefined) return '';
  if (lagSeconds < 1) return 'llegó al momento';
  return `llegó ${formatDuration(lagSeconds)} después`;
}

/** `late_sync: true` (más de 15 min entre medición y recepción) → "sincronizado tarde". */
export function lateSyncLabel(lateSync: boolean | null | undefined): string {
  return lateSync ? 'sincronizado tarde' : '';
}

/**
 * Línea de "cuándo se registró": "registrado hace 2 h · llegó 1 h 50 min después ·
 * sincronizado tarde". lag_s y late_sync son opcionales (solo vienen de lecturas).
 */
export function registeredLabel(
  measuredAt: string,
  now: number,
  lagSeconds?: number | null,
  lateSync?: boolean | null,
): string {
  return [`registrado ${timeAgo(measuredAt, now)}`, lagLabel(lagSeconds), lateSyncLabel(lateSync)]
    .filter(Boolean)
    .join(' · ');
}

/** Segundos que faltan hasta `iso` (0 si ya pasó). */
export function secondsUntil(iso: string, now: number): number {
  return Math.max(0, Math.ceil((toMs(iso) - now) / 1000));
}

/** Cuenta regresiva hasta deliver_at: "faltan 1 min 25 s" (vacío si ya pasó). */
export function countdownLabel(iso: string, now: number): string {
  const s = secondsUntil(iso, now);
  return s > 0 ? `faltan ${formatDuration(s)}` : '';
}

export type DeliveryKind = 'pending' | 'in_transit' | 'delivered';

export interface DeliveryState {
  kind: DeliveryKind;
  /** Texto principal ("Llega a bordo a las 08:12"). */
  label: string;
  /** Cuenta regresiva (solo en camino). */
  countdown: string;
}

/**
 * Estado a bordo de un mensaje de Tierra según `deliver_at`:
 * - null → en cola por un corte de enlace: "Pendiente de envío: sin enlace".
 * - futuro → "Llega a bordo a las hh:mm" + cuenta regresiva.
 * - pasado → "Entregado a bordo".
 */
export function deliveryState(deliverAt: string | null | undefined, now: number): DeliveryState {
  if (!deliverAt) return { kind: 'pending', label: 'Pendiente de envío: sin enlace', countdown: '' };
  if (toMs(deliverAt) > now) {
    return {
      kind: 'in_transit',
      label: `Llega a bordo a las ${clockTime(deliverAt)}`,
      countdown: countdownLabel(deliverAt, now),
    };
  }
  return { kind: 'delivered', label: 'Entregado a bordo', countdown: '' };
}
