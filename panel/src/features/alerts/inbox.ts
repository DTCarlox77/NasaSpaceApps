/**
 * Lógica de la bandeja de Tierra (sin React, para probarla sola).
 * Orden del contrato: prioridad (emergency > urgent > routine) y luego `deliver_at` ascendente
 * (lo que espera desde hace más tiempo, primero).
 */
import type {
  EscalationStatus,
  GroundRole,
  InboxCategory,
  InboxItem,
  InboxPage,
  Priority,
  TriageCategory,
} from '../../api/types.ts';

export const PRIORITY_ORDER: readonly Priority[] = ['emergency', 'urgent', 'routine'];

export const PRIORITY_LABELS: Record<Priority, { icon: string; text: string }> = {
  emergency: { icon: '■', text: 'Emergencia' },
  urgent: { icon: '▲', text: 'Urgente' },
  routine: { icon: '●', text: 'Rutina' },
};

export const CATEGORY_LABELS: Record<InboxCategory, string> = {
  reading: 'Lectura',
  emergency: 'Emergencia',
  wellbeing: 'Bienestar',
  manual: 'Manual',
};

export const SOURCE_LABELS: Record<InboxItem['source_type'], string> = {
  reading: 'Lectura',
  emergency_assessment: 'Evaluación de triaje',
  emergency_session: 'Sesión de emergencia',
  wellbeing: 'Bienestar',
  manual: 'Manual',
};

export const STATUS_LABELS: Record<EscalationStatus, string> = {
  queued: 'En camino a Tierra',
  delivered: 'Sin acuse',
  acknowledged: 'Con acuse',
  responded: 'Respondida',
  closed: 'Cerrada',
};

/** Filtro de estado del contrato (status de GET /admin/inbox). */
export const STATUS_FILTERS = ['delivered', 'acknowledged', 'responded'] as const;

export const TRIAGE_LABELS: Record<TriageCategory, string> = {
  green: 'Verde',
  yellow: 'Amarillo',
  red: 'Rojo',
  black: 'Negro',
};

export const RADIATION_LABELS = {
  none: 'sin indicio de radiación',
  possible: 'radiación posible',
  probable: 'radiación probable',
} as const;

/** Lo único que se muestra de una alerta de bienestar (nunca valores ni el motivo). */
export const WELLBEING_TEXT = 'Alerta de bienestar escalada · el detalle es confidencial';

export const isWellbeing = (item: InboxItem): boolean => item.category === 'wellbeing';

/** Categorías del filtro: admin no recibe las de bienestar (el contrato se las oculta). */
export function categoryOptions(role: GroundRole | null): InboxCategory[] {
  const all: InboxCategory[] = ['emergency', 'reading', 'wellbeing', 'manual'];
  return role === 'flight_surgeon' ? all : all.filter((c) => c !== 'wellbeing');
}

const rank = (priority: Priority): number => {
  const r = PRIORITY_ORDER.indexOf(priority);
  return r === -1 ? PRIORITY_ORDER.length : r;
};

export function sortInbox(items: InboxItem[]): InboxItem[] {
  return [...items].sort(
    (a, b) =>
      rank(a.priority) - rank(b.priority) ||
      a.deliver_at.localeCompare(b.deliver_at) ||
      a.id.localeCompare(b.id),
  );
}

/** Une las páginas cargadas (sin duplicados: el sondeo puede mover un elemento de página). */
export function mergePages(pages: InboxPage[] | undefined): InboxItem[] {
  const byId = new Map<string, InboxItem>();
  for (const page of pages ?? []) {
    for (const item of Array.isArray(page?.items) ? page.items : []) byId.set(item.id, item);
  }
  return sortInbox([...byId.values()]);
}

export const crewLabel = (item: InboxItem): string => item.call_sign ?? 'Toda la tripulación';

/** "Triaje: Rojo · radiación probable" (solo si viene). */
export function triageLabel(item: InboxItem): string {
  const triage = item.triage;
  if (!triage?.triage_category) return '';
  const radiation = triage.radiation_flag ? ` · ${RADIATION_LABELS[triage.radiation_flag]}` : '';
  return `Triaje: ${TRIAGE_LABELS[triage.triage_category]}${radiation}`;
}
