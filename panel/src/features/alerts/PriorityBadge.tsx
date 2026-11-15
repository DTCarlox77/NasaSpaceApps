import type { Priority } from '../../api/types.ts';
import { PRIORITY_LABELS } from './inbox.ts';

/** Prioridad con símbolo y texto (no solo color). */
export function PriorityBadge({ priority }: { priority: Priority }) {
  const meta = PRIORITY_LABELS[priority] ?? { icon: '●', text: priority };
  return (
    <span className={`priority-badge priority-${priority}`}>
      <span aria-hidden="true">{meta.icon}</span>
      {meta.text}
    </span>
  );
}
