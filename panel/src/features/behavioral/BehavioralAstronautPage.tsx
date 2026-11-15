/**
 * Salud conductual · Detalle por astronauta (/salud-conductual/astronauta/:astronautId), SOLO
 * behavioral_health. GET /admin/behavioral/astronauts/{id} cada 60 s (cada consulta queda en la
 * auditoría de accesos confidenciales).
 * - 4 deslizadores (ánimo, fatiga, estrés, roces) en el tiempo con la banda del rango habitual
 *   (estimada por el panel) y la z adversa de la API.
 * - PHQ-2 / GAD-2: solo positivo/negativo y fecha. PVT frente a su línea base y aptitud.
 * - Solicitudes de apoyo (acuse, respuesta con su `deliver_at`, cierre) y escalamientos abiertos
 *   (acuse y cierre).
 * - NUNCA la nota privada del check-in (screenBehavioralDetail deja solo los campos conocidos).
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  ackBehavioralEscalation,
  ackSupportRequest,
  closeBehavioralEscalation,
  closeSupportRequest,
  getBehavioralAstronaut,
  replySupportRequest,
} from '../../api/behavioral.ts';
import { describeError, HttpError } from '../../api/http.ts';
import { MISSION_DATA, queryKeys } from '../../api/queryKeys.ts';
import type {
  BehavioralCheckin,
  BehavioralEscalation,
  BehavioralIndicator,
  PvtRun,
  Screening,
  SupportMessage,
  SupportRequest,
} from '../../api/types.ts';
import { useAuth } from '../../auth/context.ts';
import { Banner } from '../../components/Banner.tsx';
import { Button } from '../../components/Button.tsx';
import { DeliveryLine } from '../../components/DeliveryLine.tsx';
import { Loading, QueryError, UpdatedAgo } from '../../components/QueryStatus.tsx';
import { StatusBadge } from '../../components/StatusBadge.tsx';
import { dateClock, dayClock, timeAgo } from '../../lib/time.ts';
import { useNow } from '../../lib/useNow.ts';
import { useMission } from '../../mission/useMission.ts';
import { canDo, type ActionId } from '../../nav/access.ts';
import { PriorityBadge } from '../alerts/PriorityBadge.tsx';
import { TREND_LABELS } from '../crew/crew.ts';
import {
  CHANNEL_LABELS,
  comparePvt,
  deltaLabel,
  DETAIL_POLL_MS,
  FITNESS_TEXT,
  indicatorLabel,
  INSTRUMENT_LABELS,
  RECENT_POINTS,
  screenBehavioralDetail,
  screeningResult,
  SLIDERS,
  STATUS_LABELS,
  usualRange,
  zLabel,
} from './behavioral.ts';
import { PvtChart, SliderChart } from './charts.tsx';
import { BehavioralTabs, ConfidentialNote, UrgencyBadge } from './common.tsx';
import './behavioral.css';

const MAX_BODY = 4000;

function actionError(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 404) return 'Todavía no llegó a Tierra o ya no existe.';
    if (err.status === 409) return 'Ya está cerrada: no admite cambios.';
    if (err.status === 400) return err.message;
  }
  return describeError(err);
}

/** Acuse o cierre con su estado; el cierre pide confirmar (no se puede deshacer). */
function ActionButtons({
  status,
  ack,
  close,
  ackAction,
  closeAction,
  onDone,
}: {
  status: string;
  ack(): Promise<unknown>;
  close(): Promise<unknown>;
  ackAction: ActionId;
  closeAction: ActionId;
  onDone(): void;
}) {
  const { role } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const ackMutation = useMutation({ mutationFn: ack, onSuccess: onDone });
  const closeMutation = useMutation({ mutationFn: close, onSuccess: () => { setConfirming(false); onDone(); } });
  if (status === 'closed') return <p className="muted small">Cerrada.</p>;
  const canAck = canDo(role, ackAction) && (status === 'open' || status === 'delivered');
  const canClose = canDo(role, closeAction);
  const error = ackMutation.error ?? closeMutation.error;
  return (
    <div className="stack-tight">
      <div className="row">
        {canAck ? (
          <Button variant="secondary" onClick={() => ackMutation.mutate()} loading={ackMutation.isPending}>
            Marcar como recibida
          </Button>
        ) : null}
        {canClose && !confirming ? (
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            Cerrar…
          </Button>
        ) : null}
        {canClose && confirming ? (
          <>
            <span className="small">¿Cerrar? Ya no admitirá respuestas.</span>
            <Button variant="secondary" onClick={() => closeMutation.mutate()} loading={closeMutation.isPending}>
              Sí, cerrar
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </>
        ) : null}
      </div>
      {error ? <Banner tone="error">{actionError(error)}</Banner> : null}
    </div>
  );
}

// ---------------------------------------------------------------- deslizadores

function SliderCard({ indicator, label }: { indicator: BehavioralIndicator | undefined; label: string }) {
  if (!indicator) {
    return (
      <article className="bh-card">
        <h3>{label}</h3>
        <p className="muted small">Sin check-ins de este deslizador.</p>
      </article>
    );
  }
  const range = usualRange(indicator.series ?? []);
  const trend = indicator.trend ? TREND_LABELS[indicator.trend] : null;
  return (
    <article className={`bh-card bh-card-${indicator.level}`} aria-labelledby={`slider-${indicator.code}`}>
      <header className="row">
        <h3 id={`slider-${indicator.code}`}>{label}</h3>
        <StatusBadge level={indicator.level} />
      </header>
      <p className="small">
        <strong className="indicator-value">{indicator.last_value ?? '—'}</strong>
        <span className="muted"> / 100 · {zLabel(indicator.adverse_z_3d)}</span>
        {indicator.adverse_sustained_days ? (
          <span className="muted"> · {indicator.adverse_sustained_days} días seguidos fuera de lo habitual</span>
        ) : null}
        {trend ? (
          <span className="muted">
            {' '}
            · <span aria-hidden="true">{trend.icon}</span> {trend.text}
          </span>
        ) : null}
      </p>
      <SliderChart name={label} points={indicator.series ?? []} range={range} />
      <p className="muted small">
        {range
          ? `Banda: rango habitual ${range.low}–${range.high} (media ± 1 desviación de ${range.points} check-ins previos a los últimos ${RECENT_POINTS}; estimado por el panel).`
          : 'Sin check-ins suficientes para estimar el rango habitual.'}
      </p>
    </article>
  );
}

// ---------------------------------------------------------------- solicitudes de apoyo

function SupportRequestCard({
  request,
  missionId,
  highlighted,
  onChanged,
  now,
}: {
  request: SupportRequest;
  missionId: string;
  highlighted: boolean;
  onChanged(): void;
  now: number;
}) {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const repliesKey = queryKeys.supportReplies(missionId, request.id);
  const replies = useQuery({
    queryKey: repliesKey,
    queryFn: () => Promise.resolve([] as SupportMessage[]),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const reply = useMutation({
    mutationFn: (body: string) => replySupportRequest(request.id, body),
    onSuccess: (message) => {
      queryClient.setQueryData<SupportMessage[]>(repliesKey, (old) => [...(old ?? []), message]);
      setText('');
      onChanged();
    },
  });
  const closed = request.status === 'closed';
  const trimmed = text.trim();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed || reply.isPending || closed) return;
    reply.mutate(trimmed);
  }

  return (
    <li className={`bh-card${highlighted ? ' bh-highlight' : ''}`}>
      <header className="row">
        <UrgencyBadge urgency={request.urgency} />
        <strong>"Quiero hablar con alguien"</strong>
        <span className="tag">{CHANNEL_LABELS[request.channel] ?? request.channel}</span>
        <span className="tag">{STATUS_LABELS[request.status] ?? request.status}</span>
      </header>
      <p className="bh-content">{request.content}</p>
      <p className="muted small">
        Pedida {timeAgo(request.created_at, now)} ·{' '}
        {request.deliver_at ? `llegó a Tierra a las ${dayClock(request.deliver_at, now)}` : 'en camino a Tierra'}
      </p>
      {(replies.data ?? []).length > 0 ? (
        <ol className="thread" aria-label="Respuestas enviadas">
          {(replies.data ?? []).map((m) => (
            <li key={m.id} className="thread-message thread-to_crew">
              <p className="small muted">De Tierra · salud conductual · {dayClock(m.created_at, now)}</p>
              <p className="bh-content">{m.body}</p>
              <p className="small">
                <DeliveryLine deliverAt={m.deliver_at} />
              </p>
            </li>
          ))}
        </ol>
      ) : null}
      {canDo(role, 'support.reply') && !closed ? (
        <form className="stack-tight" onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor={`support-reply-${request.id}`}>Respuesta</label>
            <textarea
              id={`support-reply-${request.id}`}
              rows={2}
              maxLength={MAX_BODY}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <span className="field-hint">Viaja con el retraso de la misión. Responder cuenta como acuse.</span>
          </div>
          {reply.isError ? <Banner tone="error">{actionError(reply.error)}</Banner> : null}
          <div>
            <Button type="submit" loading={reply.isPending} disabled={!trimmed}>
              Enviar a bordo
            </Button>
          </div>
        </form>
      ) : null}
      <ActionButtons
        status={request.status}
        ack={() => ackSupportRequest(request.id)}
        close={() => closeSupportRequest(request.id)}
        ackAction="support.ack"
        closeAction="support.close"
        onDone={onChanged}
      />
    </li>
  );
}

function EscalationCard({
  escalation,
  highlighted,
  onChanged,
  now,
}: {
  escalation: BehavioralEscalation;
  highlighted: boolean;
  onChanged(): void;
  now: number;
}) {
  const priority = escalation.priority as 'routine' | 'urgent' | 'emergency' | undefined;
  return (
    <li className={`bh-card${highlighted ? ' bh-highlight' : ''}`}>
      <header className="row">
        {priority ? <PriorityBadge priority={priority} /> : null}
        <strong>{indicatorLabel(escalation.indicator_code) || 'Escalamiento conductual'}</strong>
        <span className="tag">{STATUS_LABELS[escalation.status] ?? escalation.status}</span>
      </header>
      <p className="muted small">
        {escalation.measured_at ? `Registrado ${timeAgo(escalation.measured_at, now)} · ` : ''}
        llegó a Tierra a las {dayClock(escalation.deliver_at, now)}
      </p>
      <ActionButtons
        status={escalation.status}
        ack={() => ackBehavioralEscalation(escalation.id)}
        close={() => closeBehavioralEscalation(escalation.id)}
        ackAction="behavioral_escalation.ack"
        closeAction="behavioral_escalation.close"
        onDone={onChanged}
      />
    </li>
  );
}

// ---------------------------------------------------------------- tamizajes, PVT y check-ins

function Screenings({ screenings, now }: { screenings: Screening[]; now: number }) {
  const sorted = [...screenings].sort((a, b) => b.measured_at.localeCompare(a.measured_at));
  return (
    <section className="stack-tight" aria-labelledby="screenings-title">
      <h2 id="screenings-title">Tamizajes PHQ-2 y GAD-2</h2>
      <p className="muted small">Solo el resultado (positivo o negativo según la API) y la fecha; sin puntajes.</p>
      {sorted.length === 0 ? <p className="muted small">Sin tamizajes.</p> : null}
      <ul className="plain-list stack-tight">
        {sorted.map((s) => {
          const result = screeningResult(s.level);
          return (
            <li key={s.id} className="row small">
              <strong>{INSTRUMENT_LABELS[s.instrument] ?? s.instrument}</strong>
              <span className={`screening screening-${result.positive === null ? 'none' : result.positive ? 'positive' : 'negative'}`}>
                <span aria-hidden="true">{result.icon}</span> {result.text}
              </span>
              <span className="muted">{dayClock(s.measured_at, now)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Pvt({ runs, now }: { runs: PvtRun[]; now: number }) {
  const cmp = comparePvt(runs);
  return (
    <section className="stack-tight" aria-labelledby="pvt-title">
      <h2 id="pvt-title">Prueba de reacción (PVT)</h2>
      {!cmp ? (
        <p className="muted small">Sin pruebas de reacción.</p>
      ) : (
        <>
          <p>
            <strong>{FITNESS_TEXT[cmp.latest.fitness] ?? cmp.latest.fitness}</strong>{' '}
            <span className="muted small">(última prueba {timeAgo(cmp.latest.measured_at, now)})</span>
          </p>
          <p className="small">
            Tiempo medio {cmp.latest.mean_rt_ms} ms · {cmp.latest.lapses} lapsos · {cmp.latest.false_starts} falsos
            inicios. {deltaLabel(cmp)}
          </p>
          <PvtChart runs={runs} baselineMs={cmp.baselineMs} />
          <p className="muted small">Línea base: promedio de sus pruebas anteriores (estimada por el panel).</p>
          <details>
            <summary>Ver las {runs.length} pruebas en tabla</summary>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Tiempo medio</th>
                  <th scope="col">Lapsos</th>
                  <th scope="col">Falsos inicios</th>
                  <th scope="col">Antes de tarea crítica</th>
                  <th scope="col">Aptitud</th>
                </tr>
              </thead>
              <tbody>
                {[...runs]
                  .sort((a, b) => b.measured_at.localeCompare(a.measured_at))
                  .map((r) => (
                    <tr key={r.id}>
                      <td>{dateClock(r.measured_at)}</td>
                      <td>{r.mean_rt_ms} ms</td>
                      <td>{r.lapses}</td>
                      <td>{r.false_starts}</td>
                      <td>{r.before_critical_task ? 'Sí' : 'No'}</td>
                      <td>{FITNESS_TEXT[r.fitness] ?? r.fitness}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

function Checkins({ checkins }: { checkins: BehavioralCheckin[] }) {
  if (checkins.length === 0) return null;
  const sorted = [...checkins].sort((a, b) => b.measured_at.localeCompare(a.measured_at));
  const cell = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(v));
  return (
    <details>
      <summary>Ver los {checkins.length} check-ins en tabla (sin la nota privada)</summary>
      <table className="data-table">
        <caption className="muted small">La nota privada del check-in solo la ve el astronauta.</caption>
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            {SLIDERS.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
            <th scope="col">Sueño (h)</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c.id}>
              <td>{dateClock(c.measured_at)}</td>
              <td>{cell(c.mood)}</td>
              <td>{cell(c.fatigue)}</td>
              <td>{cell(c.stress)}</td>
              <td>{cell(c.crew_conflict)}</td>
              <td>{cell(c.sleep_hours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

// ---------------------------------------------------------------- página

export function BehavioralAstronautPage() {
  const { astronautId = '' } = useParams();
  const [params] = useSearchParams();
  const highlight = params.get('item');
  const { missionId } = useMission();
  const queryClient = useQueryClient();
  const now = useNow(30_000);
  const query = useQuery({
    queryKey: queryKeys.behavioralAstronaut(missionId ?? '', astronautId),
    queryFn: ({ signal }) => getBehavioralAstronaut(astronautId, signal),
    enabled: !!missionId && !!astronautId,
    refetchInterval: DETAIL_POLL_MS,
  });

  const refresh = () =>
    queryClient.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === MISSION_DATA &&
        q.queryKey[1] === missionId &&
        (q.queryKey[2] === 'behavioral-inbox' ||
          (q.queryKey[2] === 'behavioral-astronaut' && q.queryKey[3] === astronautId)),
    });

  let body: ReactNode;
  if (!query.data) {
    body = query.isError ? (
      <QueryError error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <Loading label="Cargando el detalle confidencial…" />
    );
  } else if (!query.data.astronaut) {
    body = <Banner tone="error">La respuesta no tiene la forma esperada.</Banner>;
  } else {
    const { detail } = screenBehavioralDetail(query.data);
    const byCode = new Map(detail.indicators.map((i) => [i.code, i]));
    body = (
      <>
        {!detail.baseline_ready ? (
          <Banner tone="info">Todavía no hay línea base: los niveles pueden salir "Sin datos".</Banner>
        ) : null}
        <section className="stack-tight" aria-labelledby="sliders-title">
          <h2 id="sliders-title">Check-in: los 4 deslizadores</h2>
          <div className="bh-grid">
            {SLIDERS.map((s) => (
              <SliderCard key={s.code} indicator={byCode.get(s.code)} label={s.label} />
            ))}
          </div>
          <Checkins checkins={detail.checkins ?? []} />
        </section>

        <section className="stack-tight" aria-labelledby="requests-title">
          <h2 id="requests-title">Solicitudes de apoyo</h2>
          <p className="muted small">
            Las respuestas viajan con el retraso de la misión. El contrato no le da a Tierra el hilo de la
            solicitud: aquí ves las respuestas enviadas desde este panel en esta sesión.
          </p>
          {detail.support_requests.length === 0 ? <p className="muted small">Sin solicitudes.</p> : null}
          <ul className="plain-list stack">
            {detail.support_requests.map((r) => (
              <SupportRequestCard
                key={r.id}
                request={r}
                missionId={missionId as string}
                highlighted={r.id === highlight}
                onChanged={() => void refresh()}
                now={now}
              />
            ))}
          </ul>
        </section>

        <section className="stack-tight" aria-labelledby="bh-escalations-title">
          <h2 id="bh-escalations-title">Escalamientos abiertos</h2>
          {(detail.escalations ?? []).length === 0 ? <p className="muted small">Sin escalamientos abiertos.</p> : null}
          <ul className="plain-list stack">
            {(detail.escalations ?? []).map((e) => (
              <EscalationCard
                key={e.id}
                escalation={e}
                highlighted={e.id === highlight}
                onChanged={() => void refresh()}
                now={now}
              />
            ))}
          </ul>
        </section>

        <div className="bh-two">
          <Screenings screenings={detail.screenings} now={now} />
          <Pvt runs={detail.pvt_runs} now={now} />
        </div>
      </>
    );
  }

  return (
    <section className="page page-wide stack" aria-labelledby="bh-astronaut-title">
      <p>
        <Link to="/salud-conductual">← Bandeja confidencial</Link>
      </p>
      <div className="page-header">
        <div>
          <p className="eyebrow">Salud conductual · detalle confidencial</p>
          <h1 id="bh-astronaut-title">{query.data?.astronaut?.call_sign ?? 'Tripulante'}</h1>
          <ConfidentialNote />
        </div>
        {query.data ? (
          <p className="muted page-header-meta">
            <UpdatedAgo updatedAt={query.dataUpdatedAt} now={now} failed={query.isError} fetching={query.isFetching} />
            <br />
            Se actualiza cada 60 s
          </p>
        ) : null}
      </div>
      <BehavioralTabs />
      {body}
    </section>
  );
}
