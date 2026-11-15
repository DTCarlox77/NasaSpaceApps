/**
 * Aviso global de la cabecera (flight_surgeon y admin): hay una emergencia abierta (pending o
 * active) en la misión, con enlace al detalle. Sondeo de GET /admin/emergencies: 10 s con una
 * abierta, 30 s si no. Texto y símbolo además del color.
 */
import { Link } from 'react-router';
import { useAuth } from '../auth/context.ts';
import { STATUS_META, triggerLabel } from '../features/emergencies/emergencies.ts';
import { useOpenEmergency } from '../features/emergencies/useEmergencies.ts';
import { dayClock, timeAgo } from '../lib/time.ts';
import { useNow } from '../lib/useNow.ts';
import { canSee } from '../nav/access.ts';

export function EmergencyAlert() {
  const { role } = useAuth();
  const open = useOpenEmergency(canSee(role, 'emergencies'));
  const now = useNow(10_000);
  if (!open) return null;
  return (
    <div className="emergency-alert" role="alert">
      <span className="emergency-alert-icon" aria-hidden="true">
        ■
      </span>
      <span>
        <strong>Emergencia abierta{open.mission_code ? ` en ${open.mission_code}` : ''}</strong> ·{' '}
        {STATUS_META[open.status].text} desde las {dayClock(open.started_at, now)} ({timeAgo(open.started_at, now)}) ·{' '}
        {triggerLabel(open.trigger_type)}
      </span>
      <Link to={`/emergencias/${encodeURIComponent(open.id)}`} className="emergency-alert-link">
        Ver detalle
      </Link>
    </div>
  );
}
