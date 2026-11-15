/**
 * Panel de Tierra (flight_surgeon y admin).
 * - GET /admin/dashboard/crew?mission_id=        x-roles: flight_surgeon, admin
 * - GET /indicators?sensitivity=standard          x-roles: astronaut, flight_surgeon, behavioral_health, admin
 *   (solo nombres y unidades; el panel pide únicamente los indicadores estándar).
 * - GET /admin/inbox?mission_id=&category=&status=&cursor=&limit=   x-roles: flight_surgeon, admin
 * - POST /admin/escalations/{id}/ack                x-roles: flight_surgeon, admin
 * - POST /admin/escalations/{id}/messages           x-roles: flight_surgeon, admin
 * GET /escalations/{id}/messages es solo de `astronaut`: el panel no lo usa.
 */
import { request } from './http.ts';
import { withQuery } from './params.ts';
import type { InboxFilters } from './queryKeys.ts';
import type {
  CrewDashboard,
  EscalationAck,
  EscalationMessage,
  InboxPage,
  IndicatorList,
} from './types.ts';

export function getCrewDashboard(missionId: string, signal?: AbortSignal): Promise<CrewDashboard> {
  return request<CrewDashboard>(withQuery('/admin/dashboard/crew', { mission_id: missionId }), {
    signal,
  });
}

export function getIndicatorCatalog(signal?: AbortSignal): Promise<IndicatorList> {
  return request<IndicatorList>(withQuery('/indicators', { sensitivity: 'standard' }), { signal });
}

export function getInbox(
  missionId: string,
  filters: InboxFilters,
  cursor?: string,
  limit = 25,
  signal?: AbortSignal,
): Promise<InboxPage> {
  return request<InboxPage>(
    withQuery('/admin/inbox', {
      mission_id: missionId,
      category: filters.category,
      status: filters.status,
      cursor,
      limit,
    }),
    { signal },
  );
}

/** Idempotente: un segundo acuse devuelve el primero. 404 si aún no llegó; 409 si está cerrado. */
export function ackEscalation(id: string): Promise<EscalationAck> {
  return request<EscalationAck>(`/admin/escalations/${encodeURIComponent(id)}/ack`, { method: 'POST' });
}

/** Respuesta a bordo (MessageCreate: { body }, 1–4000). Viaja con retraso (`deliver_at`). */
export function replyEscalation(id: string, body: string): Promise<EscalationMessage> {
  return request<EscalationMessage>(`/admin/escalations/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    body: { body },
  });
}
