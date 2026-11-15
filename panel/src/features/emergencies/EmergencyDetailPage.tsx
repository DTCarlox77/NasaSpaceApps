/**
 * Detalle de una emergencia (/emergencias/:emergencyId), con el esquema EmergencyDetail del
 * contrato y sondeo cada 10 s mientras está abierta (30 s si no).
 * - Todos: estado, tiempos, quién la abrió, último latido frente al umbral del hombre muerto,
 *   plazos de "estoy bien", escalamientos y línea de tiempo (sin detalles clínicos para admin).
 * - Solo flight surgeon: orden de atención con categoría de triaje y radiación, preguntas de la
 *   tripulación ("Responder en Alertas") y el reporte al cierre.
 * - admin: solo estado operativo; si la API manda algo clínico, no se muestra (screenEmergency).
 */
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type {
  Assessment,
  AttentionEntry,
  DeadmanEntry,
  EmergencyDetail,
  EmergencyEvent,
  EmergencyQuestion,
  EmergencySession,
} from '../../api/types.ts';
import { useAuth } from '../../auth/context.ts';
import { Banner } from '../../components/Banner.tsx';
import { DeliveryLine } from '../../components/DeliveryLine.tsx';
import { Loading, QueryError, UpdatedAgo } from '../../components/QueryStatus.tsx';
import { PriorityBadge } from '../alerts/PriorityBadge.tsx';
import { STATUS_LABELS } from '../alerts/inbox.ts';
import { dateClock, dayClock, formatDuration, secondsAgo, timeAgo } from '../../lib/time.ts';
import { useNow } from '../../lib/useNow.ts';
import { EmergencyStatusBadge, TriageBadge } from './badges.tsx';
import {
  ADMIN_OPERATIONAL_NOTE,
  alertHref,
  ASSESSMENT_STATUS_TEXT,
  assessmentStatusLabel,
  EMERGENCY_DISCLAIMER,
  EVENT_LABELS,
  eventDetail,
  heartbeatState,
  isOpen,
  openedByLabel,
  POLL_OPEN_MS,
  RADIATION_TEXT,
  radiationAnswers,
  reportView,
  screenEmergency,
  thresholdLabel,
  TRIAGE_META,
} from './emergencies.ts';
import { useEmergency } from './useEmergencies.ts';
import './emergencies.css';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- latido (hombre muerto)

function Heartbeat({ session }: { session: EmergencySession }) {
  const now = useNow(1_000);
  const state = heartbeatState(session, now);
  const last = session.heartbeat?.last_heartbeat_at ?? null;
  const threshold = thresholdLabel(state.thresholdSeconds);
  if (state.kind === 'closed') {
    return (
      <p className="muted small">
        Sesión {session.status === 'cancelled' ? 'cancelada' : 'cerrada'}: ya no se vigila el latido.
        {last ? ` Último latido a las ${dayClock(last, now)}.` : ''}
      </p>
    );
  }
  const warn = state.kind === 'late' || state.kind === 'lapsed';
  return (
    <div className="stack-tight">
      <p className={`heartbeat heartbeat-${state.kind}`}>
        <span aria-hidden="true">{warn ? '⚠' : state.kind === 'none' ? '○' : '♥'}</span>{' '}
        {last ? `Último latido de la tableta ${secondsAgo(last, now)}` : 'Sin latidos de la tableta todavía'}
        <span className="muted"> · {threshold}</span>
      </p>
      {warn ? (
        <Banner tone="warning">
          {state.kind === 'lapsed'
            ? 'Se perdió el latido: pasó el umbral del hombre muerto. La API ya escaló a la tripulación y al flight surgeon.'
            : `Pasó el umbral del hombre muerto (${formatDuration(state.thresholdSeconds ?? 0)}) sin latido de la tableta.`}
        </Banner>
      ) : null}
    </div>
  );
}

function DeadmanList({ entries, now }: { entries: DeadmanEntry[]; now: number }) {
  if (entries.length === 0) return null;
  const text = (e: DeadmanEntry) => {
    if (e.status === 'confirmed') return `confirmó "estoy bien" a las ${dayClock(e.confirmed_at, now)}`;
    if (e.status === 'expired') return `venció el plazo a las ${dayClock(e.expired_at ?? e.deadline_at, now)}`;
    return `esperando "estoy bien" hasta las ${dayClock(e.deadline_at, now)}`;
  };
  const icon = (e: DeadmanEntry) => (e.status === 'confirmed' ? '✓' : e.status === 'expired' ? '■' : '◐');
  return (
    <section className="stack-tight" aria-labelledby="deadman-title">
      <h2 id="deadman-title">Plazos de "estoy bien"</h2>
      <ul className="plain-list">
        {entries.map((e) => (
          <li key={e.astronaut_id}>
            <span aria-hidden="true">{icon(e)}</span> <strong>{e.call_sign}</strong>: {text(e)}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- orden de atención (flight surgeon)

function AttentionCard({ entry, assessment }: { entry: AttentionEntry; assessment: Assessment | undefined }) {
  const category = entry.triage_category ?? null;
  const radiation = entry.radiation_flag ?? assessment?.radiation_flag ?? null;
  const answers = radiationAnswers(assessment);
  const statusText =
    entry.status === 'assessed' ? 'Evaluado' : entry.status === 'in_progress' ? 'En evaluación' : 'Sin evaluar';
  return (
    <li className={`attention-card attention-${category ?? 'none'}`}>
      <header className="row">
        <span className="attention-position" aria-label={`Posición ${entry.position}`}>
          {entry.position}
        </span>
        <h3>{entry.call_sign}</h3>
        <TriageBadge category={category} />
        <span className="tag">{statusText}</span>
      </header>
      <p className="small">{entry.reason}</p>
      <div className="radiation-block">
        <p className="small">
          <strong>Módulo de radiación:</strong>{' '}
          {radiation ? RADIATION_TEXT[radiation].toLowerCase() : 'sin dato todavía'}
        </p>
        {answers.length > 0 ? (
          <ul className="plain-list small">
            {answers.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {entry.matches_device === false ? (
        <Banner tone="warning">La tableta calculó otra categoría: revisa la evaluación.</Banner>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------- preguntas (flight surgeon)

function Questions({ questions, open, now }: { questions: EmergencyQuestion[]; open: boolean; now: number }) {
  const threads = new Map<string, EmergencyQuestion[]>();
  for (const q of [...questions].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    threads.set(q.escalation_id, [...(threads.get(q.escalation_id) ?? []), q]);
  }
  return (
    <section className="stack-tight" aria-labelledby="questions-title">
      <h2 id="questions-title">Preguntas de la tripulación</h2>
      {threads.size === 0 ? <p className="muted small">La tripulación no hizo preguntas fuera del protocolo.</p> : null}
      {[...threads.entries()].map(([escalationId, messages]) => (
        <article key={escalationId} className="question-thread">
          <ol className="plain-list stack-tight">
            {messages.map((m) => (
              <li key={m.id} className={`question question-${m.direction}`}>
                <p className="small muted">
                  {m.direction === 'to_earth' ? 'De a bordo' : 'De Tierra'} · {dayClock(m.created_at, now)}
                </p>
                <p className="question-body">{m.body}</p>
                <p className="small">
                  {m.direction === 'to_earth' ? (
                    m.deliver_at ? (
                      `Llegó a Tierra a las ${dayClock(m.deliver_at, now)}`
                    ) : (
                      'En camino a Tierra'
                    )
                  ) : (
                    <DeliveryLine deliverAt={m.deliver_at} />
                  )}
                </p>
              </li>
            ))}
          </ol>
          <p>
            <Link className="btn btn-secondary" to={alertHref(escalationId)}>
              {open ? 'Responder en Alertas' : 'Ver el hilo en Alertas'}
            </Link>
          </p>
        </article>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- línea de tiempo

function Timeline({ events, clinical, now }: { events: EmergencyEvent[]; clinical: boolean; now: number }) {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at) || String(a.id).localeCompare(String(b.id)));
  return (
    <section className="stack-tight" aria-labelledby="timeline-title">
      <h2 id="timeline-title">Línea de tiempo</h2>
      {sorted.length === 0 ? <p className="muted small">Todavía no llegó ningún evento a Tierra.</p> : null}
      <ol className="timeline">
        {sorted.map((e) => {
          const detail = clinical ? eventDetail(e) : '';
          return (
            <li key={`${e.id}-${e.event_type}`} className={`timeline-event timeline-${e.event_type}`}>
              <time dateTime={e.at} className="timeline-time">
                {dayClock(e.at, now)}
              </time>
              <div>
                <p className="timeline-title">
                  {EVENT_LABELS[e.event_type] ?? e.event_type}
                  {e.call_sign ? ` · ${e.call_sign}` : ''}
                </p>
                {detail ? <p className="small">{detail}</p> : null}
                {e.delivered_at ? (
                  <p className="muted small">Llegó a Tierra a las {dayClock(e.delivered_at, now)}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- reporte (flight surgeon)

function Report({ report, now }: { report: Record<string, unknown>; now: number }) {
  const view = reportView(report);
  return (
    <section className="stack-tight report" aria-labelledby="report-title">
      <h2 id="report-title">Reporte al cierre</h2>
      {view.generatedAt ? <p className="muted small">Generado {dayClock(view.generatedAt, now)}</p> : null}
      {view.counts ? (
        <ul className="row plain-list" aria-label="Clasificación">
          {(['red', 'yellow', 'green', 'black'] as const).map((c) => (
            <li key={c} className="row">
              <TriageBadge category={c} /> <strong>{view.counts?.[c] ?? 0}</strong>
            </li>
          ))}
          <li>En curso: {view.counts.in_progress}</li>
          <li>Sin respuesta: {view.counts.unreachable}</li>
        </ul>
      ) : null}
      <ul className="plain-list small">
        <li>
          {view.differences === 0
            ? 'Sin diferencias entre la tableta y el servidor.'
            : `${view.differences} diferencia(s) entre la tableta y el servidor.`}
        </li>
        <li>Mensajes con Tierra: {view.messages}</li>
        {view.joinedActivations !== null ? <li>Activaciones unidas: {view.joinedActivations}</li> : null}
        {view.notes ? <li>Notas: {view.notes}</li> : null}
      </ul>
      {view.wellbeing ? <p className="muted small">{view.wellbeing}</p> : null}
      {view.disclaimer ? <p className="muted small">{view.disclaimer}</p> : null}
    </section>
  );
}

// ---------------------------------------------------------------- página

function DetailBody({ detail, clinical, now }: { detail: EmergencyDetail; clinical: boolean; now: number }) {
  const { session } = detail;
  const open = isOpen(session.status);
  const byId = new Map(detail.assessments.map((a) => [a.id, a]));
  const latestByAstronaut = new Map<string, Assessment>();
  for (const a of detail.assessments) latestByAstronaut.set(a.astronaut_id, a);
  return (
    <>
      <section className="stack-tight" aria-labelledby="state-title">
        <h2 id="state-title">Estado</h2>
        <dl className="facts">
          <Fact label="Inicio">
            {dateClock(session.started_at)} <span className="muted">({timeAgo(session.started_at, now)})</span>
          </Fact>
          {session.activated_at ? <Fact label="Protocolo activado">{dayClock(session.activated_at, now)}</Fact> : null}
          {session.closed_at ? (
            <Fact label={session.status === 'cancelled' ? 'Cancelada' : 'Cerrada'}>{dateClock(session.closed_at)}</Fact>
          ) : null}
          <Fact label="Abrió">{openedByLabel(session, detail.timeline)}</Fact>
          <Fact label="Protocolo">
            {session.protocol?.code ?? '—'} v{session.protocol?.version ?? '—'}
          </Fact>
          <Fact label="Evaluaciones">{assessmentStatusLabel(detail.assessments)}</Fact>
          {session.joined_activations ? (
            <Fact label="Activaciones unidas">{session.joined_activations}</Fact>
          ) : null}
        </dl>
        <Heartbeat session={session} />
      </section>

      <DeadmanList entries={session.deadman ?? []} now={now} />

      {clinical ? (
        <section className="stack-tight" aria-labelledby="attention-title">
          <h2 id="attention-title">Orden de atención</h2>
          {(detail.attention_order ?? []).length === 0 ? (
            <p className="muted small">Sin evaluaciones que ordenar.</p>
          ) : (
            <ol className="attention-list">
              {[...(detail.attention_order ?? [])]
                .sort((a, b) => a.position - b.position)
                .map((entry) => (
                  <AttentionCard
                    key={entry.astronaut_id}
                    entry={entry}
                    assessment={
                      (entry.assessment_id ? byId.get(entry.assessment_id) : undefined) ??
                      latestByAstronaut.get(entry.astronaut_id)
                    }
                  />
                ))}
            </ol>
          )}
        </section>
      ) : (
        <section className="stack-tight" aria-labelledby="crew-status-title">
          <h2 id="crew-status-title">Tripulantes evaluados</h2>
          {latestByAstronaut.size === 0 ? (
            <p className="muted small">Sin evaluaciones.</p>
          ) : (
            <ul className="plain-list">
              {[...latestByAstronaut.values()].map((a) => (
                <li key={a.astronaut_id}>
                  <strong>{a.call_sign ?? a.astronaut_id}</strong>: {ASSESSMENT_STATUS_TEXT[a.status] ?? a.status}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {clinical ? <Questions questions={detail.questions ?? []} open={open} now={now} /> : null}

      {detail.escalations.length > 0 ? (
        <section className="stack-tight" aria-labelledby="escalations-title">
          <h2 id="escalations-title">Escalamientos</h2>
          <ul className="plain-list stack-tight">
            {detail.escalations.map((e) => (
              <li key={e.id} className="row small">
                <PriorityBadge priority={e.priority} />
                <span>{e.level === 'crew' ? 'A bordo (tripulación)' : 'A Tierra (flight surgeon)'}</span>
                <span className="tag">{STATUS_LABELS[e.status] ?? e.status}</span>
                {e.deliver_at ? <span className="muted">llegó {dayClock(e.deliver_at, now)}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Timeline events={detail.timeline} clinical={clinical} now={now} />

      {clinical && detail.report ? <Report report={detail.report} now={now} /> : null}
    </>
  );
}

export function EmergencyDetailPage() {
  const { emergencyId = '' } = useParams();
  const { role } = useAuth();
  const { query } = useEmergency(emergencyId);
  const now = useNow(POLL_OPEN_MS);
  const clinical = role === 'flight_surgeon';

  let body: ReactNode;
  if (!query.data) {
    body = query.isError ? (
      <QueryError error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <Loading label="Cargando la emergencia…" />
    );
  } else if (!query.data.session) {
    body = <Banner tone="error">La respuesta no tiene la forma esperada.</Banner>;
  } else {
    const { detail, hidden } = screenEmergency(query.data, role);
    body = (
      <>
        {role === 'admin' ? <Banner tone="info">{ADMIN_OPERATIONAL_NOTE}</Banner> : null}
        {hidden > 0 && role === 'admin' ? (
          <p className="muted small">Se ocultaron {hidden} dato(s) clínicos que este rol no debe ver.</p>
        ) : null}
        <DetailBody detail={detail} clinical={clinical} now={now} />
      </>
    );
  }

  const session = query.data?.session;
  const open = isOpen(session?.status);
  return (
    <section className="page stack" aria-labelledby="emergency-title">
      <p>
        <Link to="/emergencias">← Emergencias</Link>
      </p>
      <div className="page-header">
        <div>
          <p className="eyebrow">Misión {session?.mission_code ?? '—'}</p>
          <h1 id="emergency-title" className="row">
            Emergencia {session ? <EmergencyStatusBadge status={session.status} /> : null}
          </h1>
          <p className="emergency-disclaimer">{EMERGENCY_DISCLAIMER}</p>
        </div>
        {query.data ? (
          <p className="muted page-header-meta">
            <UpdatedAgo updatedAt={query.dataUpdatedAt} now={now} failed={query.isError} fetching={query.isFetching} />
            <br />
            {open ? 'Abierta: se actualiza cada 10 s' : 'Se actualiza cada 30 s'}
          </p>
        ) : null}
      </div>
      {body}
      <p className="muted small">
        Datos sintéticos.
        {clinical
          ? ` Categorías del protocolo: ${Object.values(TRIAGE_META)
              .map((m) => `${m.text} (${m.detail})`)
              .join(', ')}.`
          : ''}
      </p>
    </section>
  );
}
