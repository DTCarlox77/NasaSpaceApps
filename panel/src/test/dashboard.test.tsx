import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as storage from '../auth/storage.ts';
import { complianceLabel, formatReading } from '../features/crew/crew.ts';
import { apiError, astronaut, catalog, currentMission, dashboard, json, pathOf, type Call } from './helpers.ts';
import { renderApp } from './renderApp.tsx';

// Las pantallas se cargan por ruta (React.lazy): se precargan para no medir la importación.
beforeAll(async () => {
  await import('../features/crew/CrewDashboardPage.tsx');
  await import('../features/crew/AstronautDetailPage.tsx');
}, 30_000);

beforeEach(() => {
  storage.clearSession();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  storage.clearSession();
});

function crewHandler(data: unknown) {
  return (call: Call) => {
    const path = pathOf(call);
    if (path === '/admin/dashboard/crew') return json(200, data);
    if (path === '/indicators') return json(200, catalog());
    if (path === '/missions/current') return json(200, currentMission());
    if (path === '/admin/inbox') return json(200, { items: [], next_cursor: null });
    return undefined;
  };
}

const cardTitles = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

describe('dashboard de tripulación', () => {
  it('ordena crítico → precaución → normal → sin datos y filtra por estado', async () => {
    renderApp(
      '/tripulacion',
      'flight_surgeon',
      crewHandler(
        dashboard([
          astronaut('ATLAS', 'normal'),
          astronaut('LYRA', 'critical'),
          astronaut('VEGA', 'unrated'),
          astronaut('ORION', 'caution'),
        ]),
      ),
    );
    await screen.findByRole('heading', { name: 'LYRA' });
    expect(cardTitles()).toEqual(['LYRA', 'ORION', 'ATLAS', 'VEGA']);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Crítico (1)' }));
    expect(cardTitles()).toEqual(['LYRA']);
    expect(screen.getByRole('button', { name: 'Crítico (1)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('muestra el valor con unidad, la aptitud en texto y la tendencia de la API', async () => {
    renderApp(
      '/tripulacion',
      'flight_surgeon',
      crewHandler(
        dashboard([
          astronaut('LYRA', 'critical', { fitness: 'not_confirmed' }),
          astronaut('ORION', 'normal'),
        ]),
      ),
    );
    const lyra = await screen.findByRole('article', { name: 'LYRA' });
    expect(within(lyra).getByText('31 rpm')).toBeInTheDocument();
    expect(within(lyra).getByText('Frecuencia respiratoria')).toBeInTheDocument();
    expect(within(lyra).getByText('Aptitud no confirmada')).toBeInTheDocument();
    expect(within(lyra).getByText('Subiendo')).toBeInTheDocument();
    expect(within(lyra).getAllByText('Crítico').length).toBeGreaterThan(0);
    const orion = screen.getByRole('article', { name: 'ORION' });
    expect(within(orion).getByText('Apto para tarea crítica')).toBeInTheDocument();
  });

  it('admin: cumplimiento null → "Sin acceso", nunca "0"; con datos, el conteo', async () => {
    renderApp(
      '/tripulacion',
      'admin',
      crewHandler(
        dashboard([
          astronaut('ATLAS', 'normal', { compliance: null }),
          astronaut('ORION', 'normal', { compliance: { checkins_completed_7d: 6, checkins_expected_7d: 7 } }),
        ]),
      ),
    );
    const atlas = await screen.findByRole('article', { name: 'ATLAS' });
    expect(within(atlas).getByText('Sin acceso')).toBeInTheDocument();
    expect(within(atlas).queryByText(/\b0\b/)).toBeNull();
    const orion = screen.getByRole('article', { name: 'ORION' });
    expect(within(orion).getByText('6 de 7 check-ins en 7 días')).toBeInTheDocument();
  });

  it('el flight_surgeon no ve cumplimiento aunque la API lo mande (y se avisa)', async () => {
    renderApp(
      '/tripulacion',
      'flight_surgeon',
      crewHandler(
        dashboard([
          astronaut('ORION', 'normal', { compliance: { checkins_completed_7d: 6, checkins_expected_7d: 7 } }),
        ]),
      ),
    );
    const orion = await screen.findByRole('article', { name: 'ORION' });
    expect(within(orion).getByText('Sin acceso')).toBeInTheDocument();
    expect(screen.queryByText(/check-ins/)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('no debe ver');
    const nav = screen.getByRole('navigation', { name: 'Secciones' });
    expect(within(nav).queryByText('Cumplimiento')).toBeNull();
    expect(complianceLabel({ checkins_completed_7d: 6, checkins_expected_7d: 7 }, 'flight_surgeon')).toBe('Sin acceso');
  });

  it('un indicador que no es del catálogo estándar (bienestar) no se muestra y se avisa', async () => {
    const moody = astronaut('ATLAS', 'caution');
    (moody.indicators as unknown[]).push({
      code: 'WB_MOOD',
      level: 'caution',
      last_value: { value: 22 },
      measured_at: '2026-11-14T07:00:00Z',
      trend: 'falling',
      series: [],
    });
    renderApp('/tripulacion', 'admin', crewHandler(dashboard([moody])));
    const atlas = await screen.findByRole('article', { name: 'ATLAS' });
    expect(within(atlas).queryByText('WB_MOOD')).toBeNull();
    expect(within(atlas).queryByText(/\b22\b/)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('1 dato que este rol no debe ver');
  });

  it('403 se muestra como mensaje, sin romper la pantalla', async () => {
    renderApp('/tripulacion', 'flight_surgeon', (call) =>
      pathOf(call) === '/admin/dashboard/crew'
        ? apiError(403, 'FORBIDDEN', 'Sin permiso')
        : crewHandler(dashboard([]))(call),
    );
    expect(await screen.findByText('Tu rol no tiene acceso a esta sección.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dashboard de tripulación' })).toBeInTheDocument();
  });

  it('sin tripulantes con lecturas: estado vacío', async () => {
    renderApp('/tripulacion', 'flight_surgeon', crewHandler(dashboard([])));
    expect(await screen.findByText('Todavía no hay lecturas físicas en esta misión.')).toBeInTheDocument();
  });

  it('detalle por tripulante con la tabla de puntos (sin endpoints nuevos)', async () => {
    const { calls } = renderApp('/tripulacion/id-ORION', 'flight_surgeon', crewHandler(dashboard([astronaut('ORION', 'caution')])));
    expect(await screen.findByRole('heading', { level: 1, name: 'ORION' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Frecuencia respiratoria' })).toBeInTheDocument();
    expect(screen.getByText('Ver los 2 puntos en tabla')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => pathOf(c) === '/admin/dashboard/crew')).toBe(true));
    const paths = new Set(calls.map(pathOf));
    expect([...paths].filter((p) => p.startsWith('/admin/')).sort()).toEqual(['/admin/dashboard/crew', '/admin/inbox']);
  });

  it('formatReading: presión como sistólica/diastólica y sin componentes que no son escalares', () => {
    const def = catalog().items[0] as Parameters<typeof formatReading>[1];
    expect(formatReading({ symptoms: [], systolic: 145, diastolic: 88 }, def)).toBe('145/88 mmHg');
    expect(formatReading({ value: 36.4 })).toBe('36,4');
  });
});
