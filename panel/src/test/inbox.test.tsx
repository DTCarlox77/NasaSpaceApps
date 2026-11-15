import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InboxItem, InboxPage } from '../api/types.ts';
import * as storage from '../auth/storage.ts';
import { mergePages, sortInbox, WELLBEING_TEXT } from '../features/alerts/inbox.ts';
import { canDo } from '../nav/access.ts';
import { currentMission, inboxItem, json, pathOf, queryOf, type Call } from './helpers.ts';
import { renderApp } from './renderApp.tsx';

// Las pantallas se cargan por ruta (React.lazy): se precargan para no medir la importación.
beforeAll(async () => {
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

const item = (id: string, extra: Record<string, unknown> = {}) => inboxItem(id, extra) as InboxItem;

/** Bandeja simulada: `pages` por cursor (undefined = primera página). */
function inboxHandler(
  pages: Record<string, InboxPage>,
  extra?: (call: Call) => Response | Promise<Response> | undefined,
) {
  return (call: Call) => {
    const path = pathOf(call);
    if (path === '/missions/current') return json(200, currentMission());
    if (path === '/admin/inbox') {
      const cursor = queryOf(call).get('cursor') ?? 'first';
      return json(200, pages[cursor] ?? { items: [], next_cursor: null });
    }
    return extra?.(call);
  };
}

const rowNames = () =>
  within(screen.getByRole('list', { name: 'Alertas' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.inbox-reason')?.textContent);

describe('bandeja: orden', () => {
  it('prioridad (emergency > urgent > routine) y luego deliver_at ascendente', () => {
    const sorted = sortInbox([
      item('a', { priority: 'routine', deliver_at: '2026-11-14T07:00:00Z' }),
      item('b', { priority: 'emergency', deliver_at: '2026-11-14T08:05:00Z' }),
      item('c', { priority: 'urgent', deliver_at: '2026-11-14T08:00:00Z' }),
      item('d', { priority: 'emergency', deliver_at: '2026-11-14T08:01:00Z' }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('une las páginas sin duplicados (el sondeo puede mover un elemento)', () => {
    const merged = mergePages([
      { items: [item('a'), item('b')], next_cursor: 'c2' },
      { items: [item('b', { status: 'acknowledged' }), item('c')], next_cursor: null },
    ]);
    expect(merged.map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);
    expect(merged.find((i) => i.id === 'b')?.status).toBe('acknowledged');
  });

  it('la pantalla lista por prioridad y "Cargar más" pide la página siguiente con el cursor', async () => {
    const { calls } = renderApp(
      '/alertas',
      'flight_surgeon',
      inboxHandler({
        first: {
          items: [item('r1', { priority: 'routine' }), item('e1', { priority: 'emergency' })],
          next_cursor: 'c2',
        },
        c2: { items: [item('u1', { priority: 'urgent' })], next_cursor: null },
      }),
    );
    await screen.findByText('Motivo e1');
    expect(rowNames()).toEqual(['Motivo e1', 'Motivo r1']);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cargar más' }));
    await screen.findByText('Motivo u1');
    expect(rowNames()).toEqual(['Motivo e1', 'Motivo u1', 'Motivo r1']);
    const inboxCalls = calls.filter((c) => pathOf(c) === '/admin/inbox' && queryOf(c).get('cursor') === 'c2');
    expect(inboxCalls).toHaveLength(1);
    expect(queryOf(inboxCalls[0] as Call).get('mission_id')).toBe(currentMission().mission.id);
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull();
  });
});

describe('bandeja: bienestar y roles', () => {
  it('una alerta de bienestar no muestra detalle (ni en la lista ni al abrirla)', async () => {
    const wellbeing = item('w1', {
      category: 'wellbeing',
      source_type: 'wellbeing',
      reason: 'PVT_LAPSES crítico: 12 lapsos',
      measured_at: '2026-11-14T07:00:00Z',
      evaluation: { code: 'PVT_LAPSES', level: 'critical', rule_index: 1, escalation: 'flight_surgeon' },
    });
    renderApp('/alertas?alerta=w1', 'flight_surgeon', inboxHandler({ first: { items: [wellbeing], next_cursor: null } }));
    const panel = await screen.findByRole('complementary', { name: 'Detalle de la alerta' });
    expect(screen.getAllByText(WELLBEING_TEXT).length).toBe(2);
    expect(screen.queryByText(/12 lapsos/)).toBeNull();
    expect(screen.queryByText(/PVT_LAPSES/)).toBeNull();
    expect(within(panel).queryByText(/registrado/)).toBeNull();
  });

  it('admin no tiene el filtro de bienestar; el flight surgeon sí', async () => {
    renderApp('/alertas', 'admin', inboxHandler({}));
    const select = await screen.findByLabelText('Categoría');
    expect(within(select).queryByRole('option', { name: 'Bienestar' })).toBeNull();
    expect(within(select).getByRole('option', { name: 'Emergencia' })).toBeInTheDocument();
  });

  it('acuse y respuesta: solo los roles del x-roles (flight_surgeon, admin)', () => {
    expect(canDo('flight_surgeon', 'escalation.ack')).toBe(true);
    expect(canDo('admin', 'escalation.reply')).toBe(true);
    expect(canDo('behavioral_health', 'escalation.ack')).toBe(false);
    expect(canDo('behavioral_health', 'escalation.reply')).toBe(false);
    expect(canDo('astronaut', 'escalation.reply')).toBe(false);
  });

  it('el triaje se muestra si viene', async () => {
    renderApp(
      '/alertas',
      'flight_surgeon',
      inboxHandler({
        first: {
          items: [
            item('e1', {
              category: 'emergency',
              source_type: 'emergency_assessment',
              priority: 'emergency',
              triage: { triage_category: 'red', radiation_flag: 'probable' },
            }),
          ],
          next_cursor: null,
        },
      }),
    );
    expect(await screen.findByText('Triaje: Rojo · radiación probable')).toBeInTheDocument();
  });

  it('contador de la barra lateral: alertas sin acuse', async () => {
    renderApp(
      '/tripulacion',
      'flight_surgeon',
      (call) => {
        if (pathOf(call) === '/admin/inbox' && queryOf(call).get('status') === 'delivered') {
          return json(200, { items: [item('a'), item('b'), item('c')], next_cursor: null });
        }
        return inboxHandler({})(call);
      },
    );
    const nav = await screen.findByRole('navigation', { name: 'Secciones' });
    await waitFor(() => expect(within(nav).getByRole('link', { name: /Alertas/ })).toHaveTextContent('Alertas3 sin acuse'));
  });
});

describe('bandeja: acuse y respuesta', () => {
  it('acuse: botón deshabilitado mientras se envía, una sola petición', async () => {
    let release: (r: Response) => void = () => undefined;
    const pendingAck = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { calls } = renderApp(
      '/alertas?alerta=a1',
      'flight_surgeon',
      inboxHandler({ first: { items: [item('a1')], next_cursor: null } }, (call) =>
        call.path === '/admin/escalations/a1/ack' ? pendingAck : undefined,
      ),
    );

    const ui = userEvent.setup();
    const button = await screen.findByRole('button', { name: 'Marcar como recibida' });
    await ui.click(button);
    expect(button).toBeDisabled();
    await ui.click(button);
    expect(calls.filter((c) => c.path === '/admin/escalations/a1/ack')).toHaveLength(1);

    release(
      json(200, {
        id: 'a1',
        status: 'acknowledged',
        acknowledged_at: '2026-11-14T08:06:10Z',
        acknowledged_by: '00000000-0000-4000-8000-000000000002',
      }),
    );
    expect(await screen.findByText(/Acuse a las/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Marcar como recibida' })).toBeNull();
  });

  it('respuesta: manda { body } y muestra el estado a bordo según deliver_at', async () => {
    const future = new Date(Date.now() + 90_000).toISOString();
    const replies = [future, null];
    const { calls } = renderApp(
      '/alertas?alerta=a1',
      'admin',
      inboxHandler({ first: { items: [item('a1')], next_cursor: null } }, (call) =>
        call.path === '/admin/escalations/a1/messages'
          ? json(201, {
              id: `m${replies.length}`,
              escalation_id: 'a1',
              direction: 'to_crew',
              author_role: 'admin',
              body: (call.body as { body: string }).body,
              created_at: new Date().toISOString(),
              deliver_at: replies.shift() ?? null,
            })
          : undefined,
      ),
    );
    const ui = userEvent.setup();
    const box = await screen.findByLabelText('Respuesta a la tripulación');
    await ui.type(box, '  Recibido, repetir mañana.  ');
    await ui.click(screen.getByRole('button', { name: 'Enviar a bordo' }));
    expect(await screen.findByText(/Llega a bordo a las/)).toBeInTheDocument();
    expect(screen.getByText(/faltan 1 min/)).toBeInTheDocument();
    const sent = calls.find((c) => c.path === '/admin/escalations/a1/messages');
    expect(sent?.body).toEqual({ body: 'Recibido, repetir mañana.' });

    await ui.type(screen.getByLabelText('Respuesta a la tripulación'), 'Segunda');
    await ui.click(screen.getByRole('button', { name: 'Enviar a bordo' }));
    expect(await screen.findByText('Pendiente de envío: sin enlace')).toBeInTheDocument();
  });
});
