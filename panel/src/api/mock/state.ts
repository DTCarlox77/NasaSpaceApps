/**
 * Estado en memoria del modo demo. Se arma la primera vez que se usa, con fechas relativas a
 * "ahora" (`t0`), para que todo se vea reciente. Lo que el panel escribe (acuses, respuestas,
 * cierres) vive aquí hasta recargar la página.
 */
import type { ConfidentialAccess, EscalationMessage, InboxItem, SupportMessage } from '../types.ts';
import {
  buildAudit,
  buildBehavioralEscalations,
  buildSupportRequests,
  type MockBehavioralEscalation,
  type MockSupportRequest,
} from './fixtures/behavioral.ts';
import { buildEmergencies, type MockEmergency } from './fixtures/emergencies.ts';
import { buildInbox, buildMessages } from './fixtures/inbox.ts';

export interface MockState {
  t0: number;
  escalations: InboxItem[];
  messages: EscalationMessage[];
  emergencies: MockEmergency[];
  supportRequests: MockSupportRequest[];
  supportMessages: SupportMessage[];
  behavioralEscalations: MockBehavioralEscalation[];
  audit: ConfidentialAccess[];
}

let state: MockState | null = null;

export function createState(t0: number): MockState {
  return {
    t0,
    escalations: buildInbox(t0),
    messages: buildMessages(t0),
    emergencies: buildEmergencies(t0),
    supportRequests: buildSupportRequests(t0),
    supportMessages: [],
    behavioralEscalations: buildBehavioralEscalations(t0),
    audit: buildAudit(t0),
  };
}

export function getState(now: number): MockState {
  if (!state) state = createState(now);
  return state;
}

/** Vuelve a los datos de partida (con `t0` = ahora o el que se pase). Lo usan las pruebas. */
export function resetMockState(t0: number = Date.now()): void {
  state = createState(t0);
}
