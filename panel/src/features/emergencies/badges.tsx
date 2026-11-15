/** Insignias de Emergencias: siempre símbolo + texto además del color. */
import type { EmergencyStatus, TriageCategory } from '../../api/types.ts';
import { STATUS_META, TRIAGE_META } from './emergencies.ts';

export function TriageBadge({ category }: { category: TriageCategory | null | undefined }) {
  if (!category || !TRIAGE_META[category]) {
    return (
      <span className="triage-badge triage-none">
        <span aria-hidden="true">○</span>Sin categoría
      </span>
    );
  }
  const meta = TRIAGE_META[category];
  return (
    <span className={`triage-badge triage-${category}`}>
      <span aria-hidden="true">{meta.icon}</span>
      {meta.text} · {meta.detail}
    </span>
  );
}

export function EmergencyStatusBadge({ status }: { status: EmergencyStatus }) {
  const meta = STATUS_META[status] ?? { icon: '·', text: status };
  return (
    <span className={`emergency-status emergency-status-${status}`}>
      <span aria-hidden="true">{meta.icon}</span>
      {meta.text}
    </span>
  );
}
