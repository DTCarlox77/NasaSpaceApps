/**
 * Salud conductual (fetch simulado, sin red): solo behavioral_health, nunca la nota privada,
 * PHQ-2/GAD-2 solo positivo/negativo, rango habitual y PVT frente a su línea base.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { BehavioralAstronautDetail } from '../api/types.ts';
import * as storage from '../auth/storage.ts';
import {
  comparePvt,
  CONFIDENTIAL_TEXT,
  screenBehavioralDetail,
  screeningResult,
  usualRange,
} from '../features/behavioral/behavioral.ts';
import { canDo } from '../nav/access.ts';
import { currentMission, json, pathOf, type Call } from './helpers.ts';
import { renderApp } from './renderApp.tsx';

beforeAll(async () => {
  await import('../features/behavioral/BehavioralInboxPage.tsx');
  await import('../features/behavioral/BehavioralAstronautPage.tsx');
  await import('../features/behavioral/ConfidentialAuditPage.tsx');
}, 30_000);

beforeEach(() => {
  storage.clearSession();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  storage.clearSession();
});

const VEGA = '10000000-0000-4000-8000-000000000012';
const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n, 21)).toISOString();
const series = (values: number[]) => values.map((value, i) => ({ measured_at: day(i), value }));

function vegaDetail(): BehavioralAstronautDetail & { checkins: Record<string, unknown>[] } {
  const stress = [45, 47, 44, 46, 45, 43, 46, 48, 44, 78, 82, 85, 88, 90];
  return {
    astronaut: { id: VEGA, call_sign: 'VEGA' },
    generated_at: day(14),
    baseline_ready: true,
    indicators: [
      { code: 'WB_STRESS', level: 'caution', escalation: 'behavioral_health', last_value: 90, adverse_z_3d: 2.1, adverse_sustained_days: 5, trend: 'rising', series: series(stress) },
      { code: 'WB_MOOD', level: 'normal', escalation: 'self_care', last_value: 60, adverse_z_3d: 0.2, adverse_sustained_days: 0, trend: 'stable', series: series(stress.map(() => 60)) },
    ],
    // La API NO debe mandar la nota privada; si llegara, el panel no la muestra.
    checkins: [
      { id: 'c1', measured_at: day(13), mood: 60, fatigue: 55, stress: 90, crew_conflict: 20, sleep_hours: 6.2, note: 'NOTA PRIVADA DE VEGA', private_note: 'OTRA NOTA PRIVADA' },
    ],
    escalations: [{ id: 'be-1', indicator_code: 'WB_STRESS', status: 'delivered', priority: 'routine', created_at: day(13), deliver_at: day(13), measured_at: day(13) }],
    screenings: [{ id: 's1', instrument: 'GAD2', score: 4, item_1: 2, item_2: 2, level: 'caution', measured_at: day(13) }],
    pvt_runs: [
      { id: 'p1', measured_at: day(10), lapses: 2, mean_rt_ms: 250, false_starts: 0, before_critical_task: false, fitness: 'fit' },
      { id: 'p2', measured_at: day(12), lapses: 2, mean_rt_ms: 254, false_starts: 0, before_critical_task: false, fitness: 'fit' },
      { id: 'p3', measured_at: day(13), lapses: 3, mean_rt_ms: 262, false_starts: 0, before_critical_task: false, fitness: 'fit' },
    ],
    support_requests: [
      { id: 'sr-1', client_uuid: 'cd-1', astronaut_id: VEGA, status: 'open', urgency: 'today', channel: 'message', content: 'Quiero comentar algo de la convivencia.', created_at: day(13), received_at: day(13), deliver_at: day(13) },
    ],
  } as BehavioralAstronautDetail & { checkins: Record<string, unknown>[] };
}

function bhHandler(extra?: (call: Call) => Response | undefined) {
  return (call: Call) => {
    const path = pathOf(call);
    if (path === '/missions/current') return json(200, currentMission());
    if (path === `/admin/behavioral/astronauts/${VEGA}`) return json(200, vegaDetail());
    if (path === '/admin/behavioral/inbox') {
      return json(200, {
        items: [
          { id: 'sr-1', astronaut_id: VEGA, call_sign: 'VEGA', kind: 'support_request', urgency: 'now', channel: 'message', priority: null, status: 'open', summary: 'Solicitud de apoyo por mensaje', created_at: day(13), measured_at: day(13), deliver_at: day(13) },
        ],
        next_cursor: null,
      });
    }
    return extra?.(call);
  };
}

describe('salud conductual: acceso', () => {
  it('admin y flight_surgeon: "Sin acceso", sin la sección en la navegación y sin llamadas conductuales', async () => {
    for (const role of ['admin', 'flight_surgeon'] as const) {
      const { calls } = renderApp('/salud-conductual', role, bhHandler());
      expect(await screen.findByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument();
      const nav = screen.getByRole('navigation', { name: 'Secciones' });
      expect(within(nav).queryByRole('link', { name: /Salud conductual/ })).toBeNull();
      expect(calls.some((c) => pathOf(c).startsWith('/admin/behavioral') || pathOf(c).startsWith('/admin/audit'))).toBe(false);
      vi.unstubAllGlobals();
      storage.clearSession();
      document.body.innerHTML = '';
    }
  });

  it('las acciones conductuales son solo de behavioral_health', () => {
    for (const action of ['support.ack', 'support.reply', 'support.close', 'behavioral_escalation.ack', 'behavioral_escalation.close'] as const) {
      expect(canDo('behavioral_health', action)).toBe(true);
      expect(canDo('admin', action)).toBe(false);
      expect(canDo('flight_surgeon', action)).toBe(false);
    }
  });
});

describe('salud conductual: pantallas', () => {
  it('bandeja: texto de confidencialidad, urgencia con texto y enlace al detalle', async () => {
    renderApp('/salud-conductual', 'behavioral_health', bhHandler());
    expect(await screen.findByText(CONFIDENTIAL_TEXT)).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Bandeja confidencial' });
    expect(within(list).getByText('Ahora')).toBeInTheDocument();
    expect(within(list).getByRole('link')).toHaveAttribute(
      'href',
      `/salud-conductual/astronauta/${VEGA}?item=sr-1`,
    );
  });

  it('detalle: nunca la nota privada; PHQ-2/GAD-2 sin puntaje; banda y PVT', async () => {
    renderApp(`/salud-conductual/astronauta/${VEGA}`, 'behavioral_health', bhHandler());
    expect(await screen.findByRole('heading', { level: 1, name: 'VEGA' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Estrés' })).toBeInTheDocument());
    // Nunca la nota privada (ni en el DOM, ni oculta en una tabla plegada).
    expect(document.body.textContent).not.toMatch(/NOTA PRIVADA/);
    // GAD-2: solo positivo/negativo y la fecha.
    expect(screen.getByText('GAD-2 (ansiedad)')).toBeInTheDocument();
    expect(screen.getByText(/Positivo/)).toBeInTheDocument();
    expect(screen.queryByText(/puntaje 4|score/i)).toBeNull();
    // z de la API y banda del rango habitual (estimada por el panel).
    expect(screen.getByText(/z adversa \(3 días\): \+2,1/)).toBeInTheDocument();
    const stress = vegaDetail().indicators.find((i) => i.code === 'WB_STRESS');
    const range = usualRange(stress?.series ?? []);
    expect(range).not.toBeNull();
    expect(screen.getByText(new RegExp(`Banda: rango habitual ${range?.low}–${range?.high} `))).toBeInTheDocument();
    // PVT contra su línea base.
    expect(screen.getByText(/10 ms más lento que su promedio de las 2 anteriores \(252 ms\)/)).toBeInTheDocument();
    expect(screen.getByText('Apto para tarea crítica', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('Quiero comentar algo de la convivencia.')).toBeInTheDocument();
  });

  it('screenBehavioralDetail descarta cualquier campo desconocido del check-in (la nota privada)', () => {
    const { detail, dropped } = screenBehavioralDetail(vegaDetail());
    expect(dropped).toBe(2);
    expect(Object.keys(detail.checkins?.[0] ?? {})).not.toContain('note');
    expect(JSON.stringify(detail)).not.toMatch(/NOTA PRIVADA/);
  });
});

describe('salud conductual: cálculos del panel', () => {
  it('rango habitual: media ± 1 DE sin los últimos 3 puntos; null con menos de 5 de base', () => {
    expect(usualRange(series([50, 50, 50, 50, 50, 90, 90, 90]))).toEqual({ low: 50, high: 50, mean: 50, points: 5 });
    expect(usualRange(series([50, 60, 70, 90]))).toBeNull();
  });

  it('PHQ-2/GAD-2: positivo o negativo según el nivel de la API', () => {
    expect(screeningResult('caution').text).toBe('Positivo');
    expect(screeningResult('critical').text).toBe('Positivo');
    expect(screeningResult('normal').text).toBe('Negativo');
    expect(screeningResult('unrated').text).toBe('Sin evaluar');
  });

  it('PVT: la última contra el promedio de las anteriores', () => {
    const cmp = comparePvt(vegaDetail().pvt_runs);
    expect(cmp?.baselineMs).toBe(252);
    expect(cmp?.deltaMs).toBe(10);
    expect(comparePvt([])).toBeNull();
  });
});
