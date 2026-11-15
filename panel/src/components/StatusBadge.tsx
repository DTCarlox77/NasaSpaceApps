/**
 * Semáforo del contrato (`level`: normal | caution | critical | unrated). Siempre lleva texto
 * y un símbolo además del color, para no depender solo de él.
 */
import type { Level } from '../api/types.ts';

const LEVELS: Record<Level, { label: string; icon: string }> = {
  normal: { label: 'Normal', icon: '●' },
  caution: { label: 'Precaución', icon: '▲' },
  critical: { label: 'Crítico', icon: '■' },
  unrated: { label: 'Sin datos', icon: '○' },
};

export function StatusBadge({ level, label }: { level: Level; label?: string }) {
  const meta = LEVELS[level] ?? LEVELS.unrated;
  return (
    <span className={`status-badge status-${level}`}>
      <span aria-hidden="true">{meta.icon}</span>
      {label ?? meta.label}
    </span>
  );
}
