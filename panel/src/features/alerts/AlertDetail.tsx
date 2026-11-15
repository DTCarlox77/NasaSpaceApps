/**
 * Detalle de una alerta de la bandeja.
 * - Acuse: POST /admin/escalations/{id}/ack (idempotente: un duplicado devuelve el primero).
 * - Respuesta: POST /admin/escalations/{id}/messages { body } → `deliver_at` (retraso o cola).
 * - Botones solo para los roles del x-roles (nav/access.ts → ACTIONS).
 * - Hilo: GET /escalations/{id}/messages es solo del astronauta (x-roles: astronaut), así que el
 *   panel muestra las respuestas enviadas desde aquí en esta sesión.
 * - Bienestar: solo estado y el texto fijo; nunca valores ni el motivo.
 */
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ackEscalation, replyEscalation } from '../../api/ground.ts';
import { describeError, HttpError } from '../../api/http.ts';
import { MISSION_DATA, queryKeys } from '../../api/queryKeys.ts';
import type { EscalationAck, EscalationMessage, GroundRole, InboxItem } from '../../api/types.ts';
import { Banner } from '../../components/Banner.tsx';
import { Button } from '../../components/Button.tsx';
import { StatusBadge } from '../../components/StatusBadge.tsx';
import { clockTime, deliveryState, registeredLabel, timeAgo } from '../../lib/time.ts';
import { useNow } from '../../lib/useNow.ts';
import { canDo } from '../../nav/access.ts';
import {
  CATEGORY_LABELS,
  crewLabel,
  isWellbeing,
  SOURCE_LABELS,
  STATUS_LABELS,
  triageLabel,
  WELLBEING_TEXT,
} from './inbox.ts';
import { PriorityBadge } from './PriorityBadge.tsx';

const MAX_BODY = 4000;

function actionError(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 404) return 'La alerta todavía no llegó a Tierra o ya no está en la bandeja.';
    if (err.status === 409) return 'El escalamiento ya está cerrado.';
    if (err.status === 400) return err.message;
  }
  return describeError(err);
}

/** Estado a bordo de un mensaje enviado; se recalcula cada segundo para la cuenta regresiva. */
function DeliveryLine({ deliverAt }: { deliverAt: string | null | undefined }) {
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

function SentMessages({ messages }: { messages: EscalationMessage[] }) {
  if (messages.length === 0) return null;
  return (
    <ol className="sent-messages">
      {messages.map((m) => (
        <li key={m.id}>
          <p className="sent-body">{m.body}</p>
          <p className="small">
            <span className="muted">Enviado a las {clockTime(m.created_at)} · </span>
            <DeliveryLine deliverAt={m.deliver_at} />
          </p>
        </li>
      ))}
    </ol>
  );
}

export function AlertDetail({
  item,
  missionId,
  role,
  now,
}: {
  item: InboxItem;
  missionId: string;
  role: GroundRole | null;
  now: number;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [ack, setAck] = useState<EscalationAck | null>(null);
  const sentKey = queryKeys.sentMessages(missionId, item.id);
  const sent = useQuery({
    queryKey: sentKey,
    queryFn: () => Promise.resolve([] as EscalationMessage[]),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const refreshInbox = () =>
    queryClient.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === MISSION_DATA &&
        q.queryKey[1] === missionId &&
        (q.queryKey[2] === 'inbox' || q.queryKey[2] === 'inbox-unacknowledged'),
    });

  const ackMutation = useMutation({
    mutationFn: () => ackEscalation(item.id),
    onSuccess: (result) => {
      setAck(result);
      void refreshInbox();
    },
  });

  const replyMutation = useMutation({
    mutationFn: (body: string) => replyEscalation(item.id, body),
    onSuccess: (message) => {
      queryClient.setQueryData<EscalationMessage[]>(sentKey, (old) => [...(old ?? []), message]);
      setText('');
      void refreshInbox();
    },
  });

  const canAck = canDo(role, 'escalation.ack');
  const canReply = canDo(role, 'escalation.reply');
  const acknowledgedAt = ack?.acknowledged_at ?? item.acknowledged_at ?? null;
  const status = ack && item.status === 'delivered' ? ack.status : item.status;
  const wellbeing = isWellbeing(item);
  const triage = triageLabel(item);
  const trimmed = text.trim();

  function onReply(event: FormEvent) {
    event.preventDefault();
    if (!trimmed || replyMutation.isPending) return;
    replyMutation.mutate(trimmed);
  }

  return (
    <article className="alert-detail stack" aria-labelledby="alert-detail-title">
      <header className="stack-tight">
        <div className="row">
          <PriorityBadge priority={item.priority} />
          <span className="tag">{CATEGORY_LABELS[item.category] ?? item.category}</span>
          <span className="tag">{STATUS_LABELS[status] ?? status}</span>
        </div>
        <h2 id="alert-detail-title">{crewLabel(item)}</h2>
      </header>

      {wellbeing ? (
        <Banner tone="info">{WELLBEING_TEXT}</Banner>
      ) : (
        <div className="stack-tight">
          <p className="alert-reason">{item.reason}</p>
          <p className="muted small">{SOURCE_LABELS[item.source_type] ?? item.source_type}</p>
          {triage ? <p className="small">{triage}</p> : null}
          {item.evaluation ? (
            <p className="small row">
              <span>Evaluación del indicador {item.evaluation.code}:</span>
              <StatusBadge level={item.evaluation.level} />
            </p>
          ) : null}
          <p className="muted small">
            {registeredLabel(item.measured_at ?? item.created_at, now, item.lag_s, item.late_sync)}
          </p>
        </div>
      )}

      <p className="small">
        Llegó a Tierra a las {clockTime(item.deliver_at)}{' '}
        <span className="muted">({timeAgo(item.deliver_at, now)})</span>
        {acknowledgedAt ? <> · Acuse a las {clockTime(acknowledgedAt)}</> : null}
      </p>

      {canAck && status === 'delivered' ? (
        <div className="stack-tight">
          <div>
            <Button
              onClick={() => ackMutation.mutate()}
              loading={ackMutation.isPending}
              disabled={ackMutation.isPending}
            >
              Marcar como recibida
            </Button>
          </div>
          {ackMutation.isError ? <Banner tone="error">{actionError(ackMutation.error)}</Banner> : null}
        </div>
      ) : null}

      <section className="stack-tight" aria-labelledby="reply-title">
        <h3 id="reply-title">Respuestas a bordo</h3>
        <p className="muted small">
          El panel no puede leer el hilo de este escalamiento (en el contrato es solo del
          astronauta). Aquí ves las respuestas enviadas desde este panel en esta sesión.
        </p>
        <SentMessages messages={sent.data ?? []} />
        {canReply && status !== 'closed' ? (
          <form className="stack-tight" onSubmit={onReply}>
            <div className="field">
              <label htmlFor="reply-body">Respuesta a la tripulación</label>
              <textarea
                id="reply-body"
                value={text}
                maxLength={MAX_BODY}
                rows={3}
                onChange={(e) => setText(e.target.value)}
                aria-describedby="reply-hint"
              />
              <span id="reply-hint" className="field-hint">
                Viaja con el retraso de la misión; si no hay enlace, queda en cola. {text.length}/
                {MAX_BODY}
              </span>
            </div>
            {replyMutation.isError ? (
              <Banner tone="error">{actionError(replyMutation.error)}</Banner>
            ) : null}
            <div>
              <Button type="submit" loading={replyMutation.isPending} disabled={!trimmed}>
                Enviar a bordo
              </Button>
            </div>
          </form>
        ) : null}
      </section>
    </article>
  );
}
