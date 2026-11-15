/**
 * Detalle de una alerta de la bandeja.
 * - Acuse: POST /admin/escalations/{id}/ack (idempotente: un duplicado devuelve el primero).
 * - Hilo: GET /admin/escalations/{id}/messages (v1.8) cada 15 s. Mensajes de a bordo y de Tierra
 *   en orden, cada uno con su estado de entrega ("Llega a bordo a las hh:mm", "Pendiente de
 *   envío: sin enlace", "Entregado a bordo"; lo de a bordo, "Llegó a Tierra a las hh:mm").
 * - Respuesta: POST /admin/escalations/{id}/messages { body } → `deliver_at`. Lo enviado en esta
 *   sesión se muestra al instante aunque el siguiente sondeo todavía no lo traiga.
 * - Cerrada: el hilo se lee, la respuesta queda deshabilitada (la API responde 409).
 * - admin en category=emergency (y en bienestar o SLEEP_HOURS, que el contrato le niega): sin
 *   hilo, acuse ni respuesta, "Solo estado operativo". Un 403 de la API muestra lo mismo.
 * - Bienestar: solo estado y el texto fijo; nunca valores ni el motivo.
 * - Botones solo para los roles del x-roles (nav/access.ts → ACTIONS).
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ackEscalation, getEscalationMessages, replyEscalation } from '../../api/ground.ts';
import { describeError, HttpError } from '../../api/http.ts';
import { MISSION_DATA, queryKeys } from '../../api/queryKeys.ts';
import type { EscalationAck, EscalationMessage, GroundRole, InboxItem } from '../../api/types.ts';
import { Banner } from '../../components/Banner.tsx';
import { Button } from '../../components/Button.tsx';
import { DeliveryLine } from '../../components/DeliveryLine.tsx';
import { StatusBadge } from '../../components/StatusBadge.tsx';
import { clockTime, dayClock, registeredLabel, timeAgo } from '../../lib/time.ts';
import { canDo } from '../../nav/access.ts';
import {
  CATEGORY_TAGS,
  CLOSED_TEXT,
  crewLabel,
  isWellbeing,
  mergeThread,
  operationalOnly,
  OPERATIONAL_ONLY_DETAIL,
  OPERATIONAL_ONLY_TEXT,
  SOURCE_LABELS,
  STATUS_LABELS,
  THREAD_POLL_MS,
  triageLabel,
  WELLBEING_TEXT,
} from './inbox.ts';
import { PriorityBadge } from './PriorityBadge.tsx';

const MAX_BODY = 4000;

const isStatus = (err: unknown, status: number) => err instanceof HttpError && err.status === status;

function actionError(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 404) return 'La alerta todavía no llegó a Tierra o ya no está en la bandeja.';
    if (err.status === 409) return 'El escalamiento ya está cerrado.';
    if (err.status === 400) return err.message;
  }
  return describeError(err);
}

function threadError(err: unknown): string {
  if (isStatus(err, 404)) return 'El hilo todavía no está disponible: la alerta no llegó a Tierra.';
  return `No se pudo cargar el hilo. ${describeError(err)}`;
}

const AUTHOR_ROLES: Record<string, string> = {
  flight_surgeon: 'flight surgeon',
  admin: 'control de misión',
};

function authorLabel(message: EscalationMessage, callSign: string | null | undefined): string {
  if (message.direction === 'to_earth') return `De a bordo${callSign ? ` · ${callSign}` : ''}`;
  const role = message.author_role ? AUTHOR_ROLES[message.author_role] : undefined;
  return `De Tierra${role ? ` · ${role}` : ''}`;
}

function OperationalOnly() {
  return (
    <Banner tone="info">
      <strong>{OPERATIONAL_ONLY_TEXT}</strong>. {OPERATIONAL_ONLY_DETAIL}
    </Banner>
  );
}

function ThreadMessage({ message, callSign, now }: { message: EscalationMessage; callSign?: string | null; now: number }) {
  return (
    <li className={`thread-message thread-${message.direction}`}>
      <p className="small muted">
        {authorLabel(message, callSign)} · {dayClock(message.created_at, now)}
      </p>
      <p className="sent-body">{message.body}</p>
      <p className="small">
        {message.direction === 'to_crew' ? (
          <DeliveryLine deliverAt={message.deliver_at} />
        ) : (
          <span className="delivery delivery-delivered">
            <span aria-hidden="true">✓</span> Llegó a Tierra a las {dayClock(message.deliver_at, now)}
          </span>
        )}
      </p>
    </li>
  );
}

/**
 * Hilo + respuesta de un escalamiento. `onForbidden` avisa si la API responde 403 (el detalle
 * pasa a "Solo estado operativo"); `onClosed`, si responde 409 (cerrado).
 */
export function EscalationThread({
  escalationId,
  missionId,
  role,
  callSign,
  closed,
  now,
  onForbidden,
  onClosed,
  onReplied,
}: {
  escalationId: string;
  missionId: string;
  role: GroundRole | null;
  callSign?: string | null;
  closed: boolean;
  now: number;
  onForbidden(): void;
  onClosed(): void;
  onReplied?(): void;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const sentKey = queryKeys.sentMessages(missionId, escalationId);
  const threadKey = queryKeys.thread(missionId, escalationId);
  const canRead = canDo(role, 'escalation.thread');
  const canReply = canDo(role, 'escalation.reply');

  const thread = useQuery({
    queryKey: threadKey,
    queryFn: ({ signal }) => getEscalationMessages(escalationId, undefined, 200, signal),
    enabled: canRead,
    refetchInterval: THREAD_POLL_MS,
  });
  const sent = useQuery({
    queryKey: sentKey,
    queryFn: () => Promise.resolve([] as EscalationMessage[]),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const forbidden = isStatus(thread.error, 403);
  useEffect(() => {
    if (forbidden) onForbidden();
  }, [forbidden, onForbidden]);

  const replyMutation = useMutation({
    mutationFn: (body: string) => replyEscalation(escalationId, body),
    onSuccess: (message) => {
      queryClient.setQueryData<EscalationMessage[]>(sentKey, (old) => [...(old ?? []), message]);
      setText('');
      void queryClient.invalidateQueries({ queryKey: threadKey });
      onReplied?.();
    },
    onError: (err) => {
      if (isStatus(err, 403)) onForbidden();
      if (isStatus(err, 409)) onClosed();
    },
  });

  const messages = useMemo(
    () => mergeThread(Array.isArray(thread.data?.items) ? thread.data.items : [], sent.data ?? []),
    [thread.data, sent.data],
  );
  const trimmed = text.trim();
  const isClosed = closed || isStatus(replyMutation.error, 409);

  function onReply(event: FormEvent) {
    event.preventDefault();
    if (!trimmed || replyMutation.isPending || isClosed) return;
    replyMutation.mutate(trimmed);
  }

  return (
    <section className="stack-tight" aria-labelledby={`thread-title-${escalationId}`}>
      <h3 id={`thread-title-${escalationId}`}>Hilo con la tripulación</h3>
      <p className="muted small">
        Se actualiza cada 15 s. Lo que manda la tripulación aparece cuando llega a Tierra.
      </p>
      {thread.isPending && canRead ? <p className="muted small">Cargando el hilo…</p> : null}
      {thread.isError && !forbidden ? <p className="muted small">⚠ {threadError(thread.error)}</p> : null}
      {messages.length > 0 ? (
        <ol className="thread" aria-label="Mensajes del hilo">
          {messages.map((m) => (
            <ThreadMessage key={m.id} message={m} callSign={callSign} now={now} />
          ))}
        </ol>
      ) : thread.isSuccess ? (
        <p className="muted small">Todavía no hay mensajes en este hilo.</p>
      ) : null}
      {thread.data?.next_cursor ? (
        <p className="muted small">El hilo tiene más mensajes de los que se muestran.</p>
      ) : null}

      {canReply ? (
        <form className="stack-tight" onSubmit={onReply}>
          {isClosed ? <Banner tone="info">{CLOSED_TEXT}</Banner> : null}
          <div className="field">
            <label htmlFor={`reply-body-${escalationId}`}>Respuesta a la tripulación</label>
            <textarea
              id={`reply-body-${escalationId}`}
              value={text}
              maxLength={MAX_BODY}
              rows={3}
              disabled={isClosed}
              onChange={(e) => setText(e.target.value)}
              aria-describedby={`reply-hint-${escalationId}`}
            />
            <span id={`reply-hint-${escalationId}`} className="field-hint">
              Viaja con el retraso de la misión; si no hay enlace, queda en cola. {text.length}/{MAX_BODY}
            </span>
          </div>
          {replyMutation.isError && !isStatus(replyMutation.error, 409) ? (
            <Banner tone="error">{actionError(replyMutation.error)}</Banner>
          ) : null}
          <div>
            <Button type="submit" loading={replyMutation.isPending} disabled={!trimmed || isClosed}>
              Enviar a bordo
            </Button>
          </div>
        </form>
      ) : null}
    </section>
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
  const [ack, setAck] = useState<EscalationAck | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [closedByApi, setClosedByApi] = useState(false);

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
    onError: (err) => {
      if (isStatus(err, 403)) setForbidden(true);
      if (isStatus(err, 409)) setClosedByApi(true);
    },
  });

  const canAck = canDo(role, 'escalation.ack');
  const acknowledgedAt = ack?.acknowledged_at ?? item.acknowledged_at ?? null;
  const status = ack && item.status === 'delivered' ? ack.status : item.status;
  const wellbeing = isWellbeing(item);
  const triage = triageLabel(item);
  const restricted = operationalOnly(item, role) || forbidden;
  const category = CATEGORY_TAGS[item.category];

  return (
    <article className="alert-detail stack" aria-labelledby="alert-detail-title">
      <header className="stack-tight">
        <div className="row">
          <PriorityBadge priority={item.priority} />
          <span className={`tag tag-category tag-${item.category}`}>
            <span aria-hidden="true">{category?.icon ?? '·'}</span> {category?.text ?? item.category}
          </span>
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
          {triage && !restricted ? <p className="small">{triage}</p> : null}
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

      {restricted ? (
        <OperationalOnly />
      ) : (
        <>
          {canAck && status === 'delivered' && !closedByApi ? (
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
          <EscalationThread
            escalationId={item.id}
            missionId={missionId}
            role={role}
            callSign={item.call_sign}
            closed={status === 'closed' || closedByApi}
            now={now}
            onForbidden={() => setForbidden(true)}
            onClosed={() => setClosedByApi(true)}
            onReplied={() => void refreshInbox()}
          />
        </>
      )}
    </article>
  );
}

/**
 * Detalle de un escalamiento que no está en la bandeja cargada (p. ej. abierto desde
 * Emergencias → "Responder en Alertas", ya cerrado o en otra página): hilo y respuesta por id.
 */
export function EscalationOnlyDetail({
  escalationId,
  missionId,
  role,
  now,
}: {
  escalationId: string;
  missionId: string;
  role: GroundRole | null;
  now: number;
}) {
  const [forbidden, setForbidden] = useState(false);
  const [closed, setClosed] = useState(false);
  return (
    <article className="alert-detail stack" aria-labelledby="alert-detail-title">
      <header className="stack-tight">
        <h2 id="alert-detail-title">Escalamiento</h2>
        <p className="muted small">
          No aparece en la bandeja cargada: puede estar cerrado, en otra página o fuera del filtro.
        </p>
      </header>
      {forbidden ? (
        <OperationalOnly />
      ) : (
        <EscalationThread
          escalationId={escalationId}
          missionId={missionId}
          role={role}
          closed={closed}
          now={now}
          onForbidden={() => setForbidden(true)}
          onClosed={() => setClosed(true)}
        />
      )}
    </article>
  );
}
