/**
 * Persistencia local del modo demo (SOLO VITE_DATA_MODE=mock; en modo api no se guarda nada aquí).
 * Clave `panel-demo-state-v1` en localStorage, JSON versionado con SOLO los cambios del usuario
 * sobre los fixtures (ids estables):
 * - `t0`: el "ahora" con el que se armaron los fixtures. Al recargar se reutiliza, así los eventos
 *   programados (la alerta de los 2 min, la solicitud de VEGA a los 2,5 min) no vuelven a llegar.
 * - Cuentas creadas o editadas (las contraseñas, solo como hash SHA-256), tripulantes y su rol,
 *   acuses, respuestas, mensajes de apoyo y cierres.
 * Toda lectura y escritura va en try/catch: si localStorage falla, o el JSON está roto o es de otra
 * versión, se ignora (aviso en consola, no en pantalla) y se arranca con los fixtures.
 */
import type { EscalationMessage, InboxItem, SupportMessage } from '../types.ts';

export const STORAGE_KEY = 'panel-demo-state-v1';
export const STATE_VERSION = 1;

/** Cuenta creada o editada en el demo (ver accounts.ts). Las contraseñas solo como hash. */
export type AccountChange = Record<string, unknown>;

export interface DemoChanges {
  version: typeof STATE_VERSION;
  t0: number;
  /** Por id de usuario: parche de una cuenta del seed o la cuenta completa si se creó en el demo. */
  accounts: Record<string, AccountChange>;
  /** Por id de escalamiento de Tierra: estado y acuse. */
  escalations: Record<string, Partial<InboxItem>>;
  /** Mensajes enviados desde el panel (hilos de Tierra). */
  messages: EscalationMessage[];
  /** Por id de solicitud de apoyo: estado, acuse y cierre. */
  supportRequests: Record<string, Record<string, unknown>>;
  supportMessages: SupportMessage[];
  /** Por id de escalamiento conductual: estado, acuse y cierre. */
  behavioralEscalations: Record<string, Record<string, unknown>>;
}

export function emptyChanges(t0: number): DemoChanges {
  return {
    version: STATE_VERSION,
    t0,
    accounts: {},
    escalations: {},
    messages: [],
    supportRequests: {},
    supportMessages: [],
    behavioralEscalations: {},
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const isRecordOfRecords = (v: unknown): v is Record<string, Record<string, unknown>> =>
  isRecord(v) && Object.values(v).every(isRecord);

const isMessageList = (v: unknown, key: 'escalation_id' | 'request_id'): boolean =>
  Array.isArray(v) && v.every((m) => isRecord(m) && typeof m.id === 'string' && typeof m[key] === 'string');

function warn(message: string, err?: unknown): void {
  // Aviso solo en consola: la demo sigue con los fixtures.
  console.warn(`[modo demo] ${message}`, err ?? '');
}

/** Lee los cambios guardados; null si no hay, si no se puede leer o si no son válidos. */
export function loadChanges(): DemoChanges | null {
  let raw: string | null;
  try {
    raw = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch (err) {
    warn('No se pudo leer localStorage; se usan los datos de partida.', err);
    return null;
  }
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    warn(`${STORAGE_KEY} tiene un JSON roto; se ignora.`, err);
    return null;
  }
  if (!isRecord(data) || data.version !== STATE_VERSION) {
    warn(`${STORAGE_KEY} es de otra versión; se ignora.`);
    return null;
  }
  const valid =
    typeof data.t0 === 'number' &&
    Number.isFinite(data.t0) &&
    isRecordOfRecords(data.accounts) &&
    isRecordOfRecords(data.escalations) &&
    isMessageList(data.messages, 'escalation_id') &&
    isRecordOfRecords(data.supportRequests) &&
    isMessageList(data.supportMessages, 'request_id') &&
    isRecordOfRecords(data.behavioralEscalations);
  if (!valid) {
    warn(`${STORAGE_KEY} no tiene la forma esperada; se ignora.`);
    return null;
  }
  return data as unknown as DemoChanges;
}

export function saveChanges(changes: DemoChanges): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(changes));
  } catch (err) {
    warn('No se pudo guardar en localStorage; los cambios quedan solo en memoria.', err);
  }
}

export function clearChanges(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch (err) {
    warn('No se pudo borrar el estado guardado.', err);
  }
}
