/**
 * Estado a bordo de un mensaje de Tierra según `deliver_at` (se recalcula cada segundo para la
 * cuenta regresiva): "Llega a bordo a las hh:mm", "Pendiente de envío: sin enlace" o "Entregado".
 */
import { deliveryState } from '../lib/time.ts';
import { useNow } from '../lib/useNow.ts';

export function DeliveryLine({ deliverAt }: { deliverAt: string | null | undefined }) {
  const now = useNow(1_000);
  const state = deliveryState(deliverAt, now);
  const icon = state.kind === 'delivered' ? '✓' : state.kind === 'pending' ? '⏸' : '→';
  return (
    <span className={`delivery delivery-${state.kind}`}>
      <span aria-hidden="true">{icon}</span> {state.label}
      {state.countdown ? <span className="muted"> · {state.countdown}</span> : null}
    </span>
  );
}
