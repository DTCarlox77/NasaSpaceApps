/**
 * Emergencias y el hilo de Alertas (fetch simulado, sin red): aviso global que aparece y
 * desaparece, "Responder en Alertas" con la escalación correcta, hilo con los tres estados de
 * entrega, cerrada → respuesta deshabilitada (409), admin solo estado operativo.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EmergencyDetail, EmergencyListItem, EscalationMessage } from '../api/types.ts';
import * as storage from '../auth/storage.ts';
import {
  heartbeatState,
  screenEmergency,
  worstCategory,
} from '../features/emergencies/emergencies.ts';
import { CLOSED_TEXT, OPERATIONAL_ONLY_TEXT } from '../features/alerts/inbox.ts';
import { screenDashboard } from '../features/crew/crew.ts';
import { apiError, currentMission, inboxItem, json, MISSION, pathOf, type Call } from './helpers.ts';
import { renderApp } from './renderApp.tsx';

beforeAll(async () => {
  await import('../features/emergencies/EmergenciesPage.tsx');
  await import('../features/emergencies/EmergencyDetailPage.tsx');
  await import('../features/alerts/AlertsPage.tsx');
  await import('../features/crew/CrewDashboardPage.tsx');
}, 30_000);

beforeEach(() => {
  storage.clearSession();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  storage.clearSession();
});

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
const inSeconds = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

function listItem(status: EmergencyListItem['status'], extra: Partial<EmergencyListItem> = {}): EmergencyListItem {
  return {
    id: 'em-1',
    mission_id: MISSION.id,
    mission_code: 'ARES-1',
    trigger_type: 'manual_button',
    status,
    started_at: ago(25 * 60),
    closed_at: status === 'closed' ? ago(60) : null,
    received_at: ago(25 * 60 - 1),
    first_delivered_at: ago(23 * 60),
    counts: { green: 1, yellow: 1, red: 1, black: 0, unreachable: 0, in_progress: 1 },
    ...extra,
  };
}

function detail(extra: Partial<EmergencyDetail> = {}): EmergencyDetail {
  return {
    session: {
      id: 'em-1',
      client_uuid: 'c-1',
      mission_id: MISSION.id,
      mission_code: 'ARES-1',
      protocol: { id: 1, code: 'crew_emergency', version: 1 },
      trigger_type: 'manual_button',
      started_by: 'u-orion',
      status: 'active',
      context: { solar_event_active: true, environment_alarm: null },
      responder_safe: true,
      next_step: 'start_assessments',
      started_at: ago(25 * 60),
      activated_at: ago(25 * 60),
      closed_at: null,
      received_at: ago(25 * 60 - 1),
      heartbeat: { dead_man_switch_seconds: 120, last_heartbeat_at: ago(10), expires_at: inSeconds(110), lapsed_at: null },
    },
    assessments: [
      {
        id: 'as-lyra',
        client_uuid: 'c-as',
        session_id: 'em-1',
        astronaut_id: 'id-LYRA',
        call_sign: 'LYRA',
        is_self_assessment: false,
        sequence_no: 1,
        status: 'completed',
        triage_category: 'red',
        radiation_flag: 'probable',
        started_at: ago(22 * 60),
        completed_at: ago(20 * 60),
        answers: [
          { question_code: 'vomiting', answer: { value: true }, source: 'tap', answered_at: ago(21 * 60) },
          { question_code: 'time_to_vomiting', answer: { choice: '1_2h' }, source: 'tap', answered_at: ago(21 * 60) },
        ],
      },
    ],
    escalations: [{ id: 'esc-q', level: 'flight_surgeon', priority: 'emergency', status: 'delivered', deliver_at: ago(600) }],
    timeline: [
      { id: 1, event_type: 'opened', at: ago(25 * 60), delivered_at: ago(23 * 60), call_sign: 'ORION', details: { trigger_type: 'manual_button' } },
      {
        id: 2,
        event_type: 'assessment_completed',
        at: ago(20 * 60),
        delivered_at: ago(18 * 60),
        call_sign: 'LYRA',
        details: { triage_category: 'red', radiation_flag: 'probable' },
      },
    ],
    attention_order: [
      {
        position: 1,
        astronaut_id: 'id-LYRA',
        call_sign: 'LYRA',
        status: 'assessed',
        assessment_id: 'as-lyra',
        triage_category: 'red',
        radiation_flag: 'probable',
        matches_device: true,
        reason: 'Rojo (inmediato), radiación probable (vómito)',
      },
    ],
    questions: [
      {
        id: 'q-1',
        session_id: 'em-1',
        escalation_id: 'esc-q',
        direction: 'to_earth',
        body: '¿La dejamos en el refugio?',
        created_at: ago(12 * 60),
        deliver_at: ago(10 * 60),
      },
    ],
    report: null,
    ...extra,
  };
}

const message = (id: string, direction: EscalationMessage['direction'], body: string, deliverAt: string | null, createdAt: string): EscalationMessage => ({
  id,
  escalation_id: 'esc-q',
  direction,
  author_role: direction === 'to_earth' ? 'astronaut' : 'flight_surgeon',
  body,
  created_at: createdAt,
  deliver_at: deliverAt,
});

const THREAD = [
  message('m1', 'to_earth', '¿La dejamos en el refugio?', ago(10 * 60), ago(12 * 60)),
  message('m2', 'to_crew', 'Mantener en el refugio.', ago(7 * 60), ago(9 * 60)),
  message('m3', 'to_crew', 'Reporten la SpO₂.', null, ago(4 * 60)),
  message('m4', 'to_crew', 'Confirmen la náusea.', inSeconds(70), ago(20)),
];

const questionItem = () =>
  inboxItem('esc-q', {
    astronaut_id: null,
    call_sign: null,
    category: 'emergency',
    source_type: 'emergency_session',
    priority: 'emergency',
    reason: 'Pregunta de la tripulación fuera del protocolo.',
  });

function baseHandler(extra: (call: Call) => Response | Promise<Response> | undefined) {
  return (call: Call) => {
    const path = pathOf(call);
    if (path === '/missions/current') return json(200, currentMission());
    return extra(call);
  };
}

describe('emergencias: aviso global en la cabecera', () => {
  it('aparece con una emergencia abierta y desaparece cuando se cierra', async () => {
    let status: EmergencyListItem['status'] = 'active';
    const { queryClient } = renderApp(
      '/tripulacion',
      'flight_surgeon',
      baseHandler((call) =>
        pathOf(call) === '/admin/emergencies' ? json(200, { items: [listItem(status)], next_cursor: null }) : undefined,
      ),
    );
    const alert = await screen.findByText(/Emergencia abierta en ARES-1/);
    const banner = alert.closest('[role="alert"]') as HTMLElement;
    expect(within(banner).getByRole('link', { name: 'Ver detalle' })).toHaveAttribute('href', '/emergencias/em-1');

    status = 'closed';
    await act(() => queryClient.refetchQueries({ queryKey: ['mission', MISSION.id, 'emergencies-open'] }));
    await waitFor(() => expect(screen.queryByText(/Emergencia abierta en ARES-1/)).toBeNull());
  });

  it('behavioral_health no consulta emergencias ni ve el aviso', async () => {
    const { calls } = renderApp(
      '/salud-conductual',
      'behavioral_health',
      baseHandler((call) =>
        pathOf(call) === '/admin/emergencies' ? json(200, { items: [listItem('active')], next_cursor: null }) : undefined,
      ),
    );
    await screen.findByRole('heading', { level: 1, name: 'Salud conductual' });
    expect(calls.some((c) => pathOf(c) === '/admin/emergencies')).toBe(false);
    expect(screen.queryByText(/Emergencia abierta/)).toBeNull();
  });
});

describe('emergencias: lista y detalle', () => {
  it('lista: estado, quién la abrió, evaluados y peor categoría (flight surgeon)', async () => {
    renderApp(
      '/emergencias',
      'flight_surgeon',
      baseHandler((call) =>
        pathOf(call) === '/admin/emergencies' ? json(200, { items: [listItem('active')], next_cursor: null }) : undefined,
      ),
    );
    const list = await screen.findByRole('list', { name: 'Emergencias' });
    expect(within(list).getByText('Activa')).toBeInTheDocument();
    expect(within(list).getByText(/Manual: botón de emergencia/)).toBeInTheDocument();
    expect(within(list).getByText('3 evaluados · 1 en curso')).toBeInTheDocument();
    expect(within(list).getByText(/Rojo · inmediato/)).toBeInTheDocument();
    expect(screen.getByText('Triaje autónomo a bordo · protocolo, no diagnóstico')).toBeInTheDocument();
  });

  it('"Responder en Alertas" abre /alertas con la escalación de esa pregunta', async () => {
    const { router } = renderApp(
      '/emergencias/em-1',
      'flight_surgeon',
      baseHandler((call) => {
        const path = pathOf(call);
        if (path === '/admin/emergencies/em-1') return json(200, detail());
        if (path === '/admin/inbox') return json(200, { items: [questionItem()], next_cursor: null });
        if (path === '/admin/escalations/esc-q/messages') return json(200, { items: THREAD, next_cursor: null });
        return undefined;
      }),
    );
    expect(await screen.findByText('¿La dejamos en el refugio?')).toBeInTheDocument();
    expect(screen.getByText('Rojo (inmediato), radiación probable (vómito)')).toBeInTheDocument();
    expect(screen.getByText('Vómito: sí, entre 1 y 2 h después del evento')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Responder en Alertas' });
    expect(link).toHaveAttribute('href', '/alertas?categoria=emergency&alerta=esc-q');

    await userEvent.setup().click(link);
    await waitFor(() => expect(router.state.location.pathname).toBe('/alertas'));
    expect(router.state.location.search).toContain('alerta=esc-q');
    const panel = await screen.findByRole('complementary', { name: 'Detalle de la alerta' });
    expect(await within(panel).findByText('Pregunta de la tripulación fuera del protocolo.', { selector: '.alert-reason' })).toBeInTheDocument();
  });

  it('último latido: aviso cuando pasa el umbral del hombre muerto del contrato', async () => {
    const late = detail();
    late.session.heartbeat = { dead_man_switch_seconds: 120, last_heartbeat_at: ago(200), expires_at: ago(80), lapsed_at: null };
    renderApp(
      '/emergencias/em-1',
      'flight_surgeon',
      baseHandler((call) => (pathOf(call) === '/admin/emergencies/em-1' ? json(200, late) : undefined)),
    );
    expect(await screen.findByText(/Pasó el umbral del hombre muerto \(2 min\)/)).toBeInTheDocument();
    expect(heartbeatState(late.session, Date.now()).kind).toBe('late');
    expect(heartbeatState(detail().session, Date.now()).kind).toBe('ok');
  });

  it('admin: solo estado operativo aunque la API mande datos clínicos', async () => {
    const full = detail({ report: { counts: { green: 1, yellow: 0, red: 1, black: 0, unreachable: 0, in_progress: 0 } } });
    renderApp(
      '/emergencias/em-1',
      'admin',
      baseHandler((call) => (pathOf(call) === '/admin/emergencies/em-1' ? json(200, full) : undefined)),
    );
    expect(await screen.findByText(/solo el estado operativo/)).toBeInTheDocument();
    expect(screen.getByText('LYRA')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Orden de atención' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Reporte al cierre' })).toBeNull();
    expect(screen.queryByText('¿La dejamos en el refugio?')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Responder en Alertas' })).toBeNull();
    expect(screen.queryByText(/Rojo/)).toBeNull();
    expect(screen.queryByText(/Vómito/)).toBeNull();
    const screened = screenEmergency(full, 'admin');
    expect(screened.hidden).toBeGreaterThan(0);
    expect(screened.detail.assessments[0]?.answers).toBeUndefined();
    expect(screened.detail.timeline.every((e) => e.details === undefined)).toBe(true);
  });

  it('peor categoría: negro > rojo > amarillo > verde', () => {
    expect(worstCategory({ green: 2, yellow: 1, red: 0, black: 0, unreachable: 0, in_progress: 0 })).toBe('yellow');
    expect(worstCategory({ green: 0, yellow: 1, red: 1, black: 1, unreachable: 0, in_progress: 0 })).toBe('black');
    expect(worstCategory(null)).toBeNull();
  });
});

describe('alertas: hilo real (GET /admin/escalations/{id}/messages)', () => {
  it('muestra los mensajes en orden con los tres estados de entrega', async () => {
    renderApp(
      '/alertas?alerta=esc-q',
      'flight_surgeon',
      baseHandler((call) => {
        const path = pathOf(call);
        if (path === '/admin/inbox') return json(200, { items: [questionItem()], next_cursor: null });
        if (path === '/admin/escalations/esc-q/messages') return json(200, { items: [...THREAD].reverse(), next_cursor: null });
        return undefined;
      }),
    );
    const thread = await screen.findByRole('list', { name: 'Mensajes del hilo' });
    const items = within(thread).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('.sent-body')?.textContent)).toEqual([
      '¿La dejamos en el refugio?',
      'Mantener en el refugio.',
      'Reporten la SpO₂.',
      'Confirmen la náusea.',
    ]);
    expect(within(items[0] as HTMLElement).getByText(/Llegó a Tierra a las/)).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText('Entregado a bordo')).toBeInTheDocument();
    expect(within(items[2] as HTMLElement).getByText('Pendiente de envío: sin enlace')).toBeInTheDocument();
    expect(within(items[3] as HTMLElement).getByText(/Llega a bordo a las/)).toBeInTheDocument();
  });

  it('escalamiento cerrado: el hilo se lee y la respuesta queda deshabilitada tras el 409', async () => {
    renderApp(
      '/alertas?alerta=esc-closed',
      'flight_surgeon',
      baseHandler((call) => {
        const path = pathOf(call);
        if (path === '/admin/inbox') return json(200, { items: [], next_cursor: null });
        if (path === '/admin/escalations/esc-closed/messages') {
          return call.method === 'GET'
            ? json(200, { items: [THREAD[0]], next_cursor: null })
            : apiError(409, 'CONFLICT', 'El escalamiento está cerrado.');
        }
        return undefined;
      }),
    );
    expect(await screen.findByText('¿La dejamos en el refugio?')).toBeInTheDocument();
    const ui = userEvent.setup();
    await ui.type(screen.getByLabelText('Respuesta a la tripulación'), 'Hola');
    await ui.click(screen.getByRole('button', { name: 'Enviar a bordo' }));
    expect(await screen.findByText(CLOSED_TEXT)).toBeInTheDocument();
    expect(screen.getByLabelText('Respuesta a la tripulación')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Enviar a bordo' })).toBeDisabled();
  });

  it('admin en category=emergency: "Solo estado operativo", sin hilo, acuse ni respuesta', async () => {
    const { calls } = renderApp(
      '/alertas?alerta=esc-q',
      'admin',
      baseHandler((call) =>
        pathOf(call) === '/admin/inbox' ? json(200, { items: [questionItem()], next_cursor: null }) : undefined,
      ),
    );
    const panel = await screen.findByRole('complementary', { name: 'Detalle de la alerta' });
    expect(within(panel).getByText(OPERATIONAL_ONLY_TEXT)).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Marcar como recibida' })).toBeNull();
    expect(within(panel).queryByLabelText('Respuesta a la tripulación')).toBeNull();
    expect(calls.some((c) => pathOf(c).startsWith('/admin/escalations/'))).toBe(false);
  });

  it('admin: un 403 del hilo muestra el mismo "Solo estado operativo"', async () => {
    renderApp(
      '/alertas?alerta=r1',
      'admin',
      baseHandler((call) => {
        const path = pathOf(call);
        if (path === '/admin/inbox') return json(200, { items: [inboxItem('r1')], next_cursor: null });
        if (path === '/admin/escalations/r1/messages') return apiError(403, 'FORBIDDEN');
        return undefined;
      }),
    );
    const panel = await screen.findByRole('complementary', { name: 'Detalle de la alerta' });
    expect(await within(panel).findByText(OPERATIONAL_ONLY_TEXT)).toBeInTheDocument();
    expect(within(panel).queryByLabelText('Respuesta a la tripulación')).toBeNull();
  });

  it('admin: si llegara una alerta de SLEEP_HOURS o de bienestar, no se lista', async () => {
    renderApp(
      '/alertas',
      'admin',
      baseHandler((call) =>
        pathOf(call) === '/admin/inbox'
          ? json(200, {
              items: [
                inboxItem('s1', { reason: 'Sueño 5 h', evaluation: { code: 'SLEEP_HOURS', level: 'critical', rule_index: 1, escalation: 'flight_surgeon' } }),
                inboxItem('w1', { category: 'wellbeing', source_type: 'wellbeing', reason: 'Bienestar' }),
                inboxItem('r1', { reason: 'Presión alta' }),
              ],
              next_cursor: null,
            })
          : undefined,
      ),
    );
    expect(await screen.findByText('Presión alta')).toBeInTheDocument();
    expect(screen.queryByText('Sueño 5 h')).toBeNull();
    expect(screen.queryByText('Bienestar')).toBeNull();
  });
});

describe('dashboard: SLEEP_HOURS nunca (defensa v1.8)', () => {
  it('se oculta para todos los roles aunque el catálogo lo marque como standard', () => {
    const catalog = new Map([
      ['SLEEP_HOURS', { code: 'SLEEP_HOURS', name: 'Horas de sueño', unit: 'h', value_type: 'simple' as const, components: [], sensitivity: 'standard' as const }],
      ['SPO2', { code: 'SPO2', name: 'SpO₂', unit: '%', value_type: 'simple' as const, components: [], sensitivity: 'standard' as const }],
    ]);
    const indicator = (code: string) => ({ code, level: 'normal' as const, last_value: { value: 1 }, measured_at: ago(60), trend: 'stable' as const, series: [] });
    const data = {
      mission_id: MISSION.id,
      mission_code: 'ARES-1',
      generated_at: ago(0),
      astronauts: [
        { astronaut_id: 'a', call_sign: 'ATLAS', crew_role: 'pilot' as const, worst_level: 'normal' as const, indicators: [indicator('SLEEP_HOURS'), indicator('SPO2')], compliance: null, fitness: 'fit' as const },
      ],
    };
    for (const role of ['admin', 'flight_surgeon'] as const) {
      for (const cat of [catalog, null]) {
        const { dashboard, hidden } = screenDashboard(data, role, cat);
        expect(dashboard.astronauts[0]?.indicators.map((i) => i.code)).toEqual(['SPO2']);
        expect(hidden).toBe(1);
      }
    }
  });
});
