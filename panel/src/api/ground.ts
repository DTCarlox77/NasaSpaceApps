/**
 * Panel de Tierra (flight_surgeon y admin).
 * - GET /admin/dashboard/crew?mission_id=        x-roles: flight_surgeon, admin
 * - GET /indicators?sensitivity=standard          x-roles: astronaut, flight_surgeon, behavioral_health, admin
 *   (solo nombres y unidades; el panel pide únicamente los indicadores estándar).
 * - GET /admin/inbox?mission_id=&category=&status=&cursor=&limit=   x-roles: flight_surgeon, admin
 * - POST /admin/escalations/{id}/ack                x-roles: flight_surgeon, admin
 * - GET  /admin/escalations/{id}/messages           x-roles: flight_surgeon, admin (v1.8: hilo)
 * - POST /admin/escalations/{id}/messages           x-roles: flight_surgeon, admin
 * Admin recibe 403 en acuse, hilo y respuesta de las alertas de bienestar y de SLEEP_HOURS; el
 * panel además no le muestra hilo, acuse ni respuesta en category=emergency (solo estado operativo).
 * GET /escalations/{id}/messages es solo de `astronaut`: el panel no lo usa.
 */
import { request } from './http.ts';
import { withQuery } from './params.ts';
import type { InboxFilters } from './queryKeys.ts';
import type {
  CrewDashboard,
  EscalationAck,
  EscalationMessage,
  EscalationMessagePage,
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

/**
 * Hilo del escalamiento visto desde Tierra (created_at ascendente). Lo de Tierra sale siempre con
 * su `deliver_at` (futuro, null = en cola, pasado); lo de a bordo, solo cuando ya llegó.
 * 404 si todavía no llegó a la bandeja; un escalamiento cerrado se puede leer.
 */
export function getEscalationMessages(
  id: string,
  cursor?: string,
  limit = 100,
  signal?: AbortSignal,
): Promise<EscalationMessagePage> {
  return request<EscalationMessagePage>(
    withQuery(`/admin/escalations/${encodeURIComponent(id)}/messages`, { cursor, limit }),
    { signal },
  );
}

/** Respuesta a bordo (MessageCreate: { body }, 1–4000). Viaja con retraso (`deliver_at`). */
export function replyEscalation(id: string, body: string): Promise<EscalationMessage> {
  return request<EscalationMessage>(`/admin/escalations/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    body: { body },
  });
}
