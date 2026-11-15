/** Piezas comunes de Salud conductual: aviso de confidencialidad, pestañas e insignias. */
import { NavLink } from 'react-router';
import type { SupportUrgency } from '../../api/types.ts';
import { CONFIDENTIAL_TEXT, URGENCY_META } from './behavioral.ts';

export function ConfidentialNote() {
  return (
    <p className="confidential-note" role="note">
      <span aria-hidden="true">◆</span> {CONFIDENTIAL_TEXT}
    </p>
  );
}

export function BehavioralTabs() {
  const cls = ({ isActive }: { isActive: boolean }) => `tab${isActive ? ' active' : ''}`;
  return (
    <nav className="tabs" aria-label="Salud conductual">
      <NavLink to="/salud-conductual" end className={cls}>
        Bandeja
      </NavLink>
      <NavLink to="/salud-conductual/auditoria" className={cls}>
        Auditoría de accesos
      </NavLink>
    </nav>
  );
}

/** Urgencia de una solicitud de apoyo (símbolo + texto). */
export function UrgencyBadge({ urgency }: { urgency: SupportUrgency }) {
  const meta = URGENCY_META[urgency] ?? { icon: '·', text: urgency, tone: 'routine' };
  return (
    <span className={`priority-badge priority-${meta.tone}`}>
      <span aria-hidden="true">{meta.icon}</span>
      {meta.text}
    </span>
  );
}
