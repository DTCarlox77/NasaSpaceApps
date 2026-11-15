/**
 * Salud conductual (CONFIDENCIAL). Todo es x-roles: [behavioral_health]; admin y el flight
 * surgeon reciben 403 (y el panel ni les muestra la sección). Cada consulta de la bandeja y del
 * detalle queda en la bitácora de accesos confidenciales.
 * - GET  /admin/behavioral/inbox?mission_id=&include_closed=&cursor=&limit=
 * - GET  /admin/behavioral/astronauts/{id}               (sin la nota privada del check-in)
 * - POST /admin/behavioral/support-requests/{id}/messages|ack|close
 * - POST /admin/behavioral/escalations/{id}/ack|close
 * - GET  /admin/audit/confidential-access?mission_id=&astronaut_id=&cursor=&limit=
 */
import { request } from './http.ts';
import { withQuery } from './params.ts';
import type {
  BehavioralAstronautDetail,
  BehavioralInboxPage,
  ClosedItem,
  ConfidentialAccessPage,
  EscalationAck,
  SupportMessage,
  SupportRequestAck,
} from './types.ts';

const id = (value: string) => encodeURIComponent(value);

export function getBehavioralInbox(
  missionId: string,
  includeClosed: boolean,
  cursor?: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<BehavioralInboxPage> {
  return request<BehavioralInboxPage>(
    withQuery('/admin/behavioral/inbox', {
      mission_id: missionId,
      include_closed: includeClosed ? 'true' : undefined,
      cursor,
      limit,
    }),
    { signal },
  );
}

export function getBehavioralAstronaut(astronautId: string, signal?: AbortSignal): Promise<BehavioralAstronautDetail> {
  return request<BehavioralAstronautDetail>(`/admin/behavioral/astronauts/${id(astronautId)}`, { signal });
}

export function getConfidentialAccess(
  missionId: string,
  cursor?: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<ConfidentialAccessPage> {
  return request<ConfidentialAccessPage>(
    withQuery('/admin/audit/confidential-access', { mission_id: missionId, cursor, limit }),
    { signal },
  );
}

/** Respuesta a una solicitud de apoyo (viaja con retraso; responder cuenta como acuse). */
export function replySupportRequest(requestId: string, body: string): Promise<SupportMessage> {
  return request<SupportMessage>(`/admin/behavioral/support-requests/${id(requestId)}/messages`, {
    method: 'POST',
    body: { body },
  });
}

export function ackSupportRequest(requestId: string): Promise<SupportRequestAck> {
  return request<SupportRequestAck>(`/admin/behavioral/support-requests/${id(requestId)}/ack`, { method: 'POST' });
}

export function closeSupportRequest(requestId: string): Promise<ClosedItem> {
  return request<ClosedItem>(`/admin/behavioral/support-requests/${id(requestId)}/close`, { method: 'POST' });
}

export function ackBehavioralEscalation(escalationId: string): Promise<EscalationAck> {
  return request<EscalationAck>(`/admin/behavioral/escalations/${id(escalationId)}/ack`, { method: 'POST' });
}

export function closeBehavioralEscalation(escalationId: string): Promise<ClosedItem> {
  return request<ClosedItem>(`/admin/behavioral/escalations/${id(escalationId)}/close`, { method: 'POST' });
}
