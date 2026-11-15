/**
 * Estado del modo demo: los fixtures (fechas relativas a `t0`) más los cambios del usuario.
 * - Se arma la primera vez que se usa. Si hay cambios guardados (persistence.ts), reutiliza su
 *   `t0` y los aplica encima; si no, `t0` = ahora y se guarda para las próximas recargas.
 * - Toda escritura pasa por los helpers de abajo, que cambian el estado vivo Y anotan el cambio
 *   en `changes`; server.ts guarda `changes` después de cada petición que escribe.
 */
import type { ConfidentialAccess, EscalationMessage, InboxItem, SupportMessage } from '../types.ts';
import {
  buildAudit,
  buildBehavioralEscalations,
  buildSupportRequests,
  type MockBehavioralEscalation,
  type MockSupportRequest,
} from './fixtures/behavioral.ts';
import { buildAccounts, isAccountRecord, type MockAccount } from './fixtures/accounts.ts';
import { buildEmergencies, type MockEmergency } from './fixtures/emergencies.ts';
import { buildInbox, buildMessages } from './fixtures/inbox.ts';
import { clearChanges, emptyChanges, loadChanges, saveChanges, type DemoChanges } from './persistence.ts';

export interface MockState {
  t0: number;
  /** Cuentas del seed más las creadas en el demo. */
  accounts: MockAccount[];
  escalations: InboxItem[];
  messages: EscalationMessage[];
  emergencies: MockEmergency[];
  supportRequests: MockSupportRequest[];
  supportMessages: SupportMessage[];
  behavioralEscalations: MockBehavioralEscalation[];
  audit: ConfidentialAccess[];
  /** Cambios del usuario sobre los fixtures (lo único que se guarda en localStorage). */
  changes: DemoChanges;
  /**
   * Contraseñas temporales recién generadas cuyo hash falta calcular (crypto.subtle es async).
   * SOLO en memoria y por un instante: server.ts las convierte en hash antes de responder.
   */
  pendingPasswords: { userId: string; password: string }[];
}

const byId = <T extends { id: string }>(list: T[], id: string) => list.find((item) => item.id === id);

function applyChanges(state: MockState, changes: DemoChanges): void {
  for (const [id, change] of Object.entries(changes.accounts)) {
    const account = byId(state.accounts, id);
    if (account) Object.assign(account, change);
    else if (change.created_in_demo === true && isAccountRecord(change)) {
      state.accounts.push(change as unknown as MockAccount);
    }
  }
  for (const [id, patch] of Object.entries(changes.escalations)) {
    const item = byId(state.escalations, id);
    if (item) Object.assign(item, patch);
  }
  for (const message of changes.messages) {
    if (!byId(state.messages, message.id)) state.messages.push(message);
  }
  for (const [id, patch] of Object.entries(changes.supportRequests)) {
    const item = byId(state.supportRequests, id);
    if (item) Object.assign(item, patch);
  }
  for (const message of changes.supportMessages) {
    if (!byId(state.supportMessages, message.id)) state.supportMessages.push(message);
  }
  for (const [id, patch] of Object.entries(changes.behavioralEscalations)) {
    const item = byId(state.behavioralEscalations, id);
    if (item) Object.assign(item, patch);
  }
  state.changes = changes;
}

export function createState(t0: number, saved?: DemoChanges | null): MockState {
  const state: MockState = {
    t0,
    accounts: buildAccounts(t0),
    escalations: buildInbox(t0),
    messages: buildMessages(t0),
    emergencies: buildEmergencies(t0),
    supportRequests: buildSupportRequests(t0),
    supportMessages: [],
    behavioralEscalations: buildBehavioralEscalations(t0),
    audit: buildAudit(t0),
    changes: emptyChanges(t0),
    pendingPasswords: [],
  };
  if (saved) {
    try {
      applyChanges(state, saved);
    } catch (err) {
      console.warn('[modo demo] No se pudieron aplicar los cambios guardados; se usan los datos de partida.', err);
      return createState(t0);
    }
  }
  return state;
}

let state: MockState | null = null;

export function getState(now: number): MockState {
  if (!state) {
    const saved = loadChanges();
    state = createState(saved?.t0 ?? now, saved);
    if (!saved) saveChanges(state.changes);
  }
  return state;
}

/** Guarda los cambios del usuario (después de cada escritura). */
export function persistState(current: MockState): void {
  saveChanges(current.changes);
}

/** Vuelve a los datos de partida: borra lo guardado y arma los fixtures con `t0` = ahora. */
export function resetMockState(t0: number = Date.now()): MockState {
  clearChanges();
  state = createState(t0);
  saveChanges(state.changes);
  return state;
}

/** Olvida el estado en memoria (como recargar la página): el próximo uso lee localStorage. */
export function forgetMockState(): void {
  state = null;
}

// ---------------------------------------------------------------- escrituras (estado + cambios)

/** Cambia una cuenta (y anota el cambio; una creada en el demo se guarda completa). */
export function patchAccount(current: MockState, account: MockAccount, patch: Partial<MockAccount>): void {
  Object.assign(account, patch);
  current.changes.accounts[account.id] = account.created_in_demo
    ? { ...account }
    : { ...current.changes.accounts[account.id], ...patch };
}

export function addAccount(current: MockState, account: MockAccount): void {
  current.accounts.push(account);
  current.changes.accounts[account.id] = { ...account };
}

export function patchEscalation(current: MockState, item: InboxItem, patch: Partial<InboxItem>): void {
  Object.assign(item, patch);
  current.changes.escalations[item.id] = { ...current.changes.escalations[item.id], ...patch };
}

export function addMessage(current: MockState, message: EscalationMessage): void {
  current.messages.push(message);
  current.changes.messages.push(message);
}

export function patchSupportRequest(
  current: MockState,
  item: MockSupportRequest,
  patch: Partial<MockSupportRequest>,
): void {
  Object.assign(item, patch);
  current.changes.supportRequests[item.id] = { ...current.changes.supportRequests[item.id], ...patch };
}

export function addSupportMessage(current: MockState, message: SupportMessage): void {
  current.supportMessages.push(message);
  current.changes.supportMessages.push(message);
}

export function patchBehavioralEscalation(
  current: MockState,
  item: MockBehavioralEscalation,
  patch: Partial<MockBehavioralEscalation>,
): void {
  Object.assign(item, patch);
  current.changes.behavioralEscalations[item.id] = { ...current.changes.behavioralEscalations[item.id], ...patch };
}
