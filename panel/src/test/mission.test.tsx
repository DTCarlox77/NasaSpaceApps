import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../api/queryKeys.ts';
import type { CurrentMission } from '../api/types.ts';
import * as storage from '../auth/storage.ts';
import { summarizeLink } from '../mission/link.ts';
import {
  astronaut,
  catalog,
  currentMission,
  dashboard,
  json,
  MISSION,
  MISSION_2,
  pathOf,
  queryOf,
  type Call,
} from './helpers.ts';
import { renderApp } from './renderApp.tsx';

beforeAll(async () => {
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

const NOW = Date.parse('2026-11-14T08:15:00Z'); // TZ=UTC en las pruebas

describe('misión seleccionada', () => {
  it('la query key cambia con la misión (y con los filtros de la bandeja)', () => {
    expect(queryKeys.crewDashboard(MISSION.id)).not.toEqual(queryKeys.crewDashboard(MISSION_2.id));
    expect(queryKeys.inbox(MISSION.id, {})).not.toEqual(queryKeys.inbox(MISSION_2.id, {}));
    expect(queryKeys.inbox(MISSION.id, {})).not.toEqual(queryKeys.inbox(MISSION.id, { status: 'delivered' }));
    expect(queryKeys.currentMission(MISSION.id)[0]).toBe('mission');
  });

  it('al cambiar de misión: nuevo mission_id en la URL y fuera los datos de la anterior', async () => {
    const handler = (call: Call) => {
      const path = pathOf(call);
      if (path === '/admin/dashboard/crew') {
        const code = queryOf(call).get('mission_id') === MISSION_2.id ? 'LUNA' : 'ARES';
        return json(200, dashboard([astronaut(code, 'normal')]));
      }
      if (path === '/indicators') return json(200, catalog());
      if (path === '/missions/current') return json(200, currentMission());
      if (path === '/admin/inbox') return json(200, { items: [], next_cursor: null });
      return undefined;
    };
    const { calls, queryClient } = renderApp('/tripulacion', 'admin', handler, {
      astronaut_id: null,
      ground_missions: [MISSION, MISSION_2],
    });
    await screen.findByRole('heading', { name: 'ARES' });
    expect(queryClient.getQueryData(queryKeys.crewDashboard(MISSION.id))).toBeDefined();

    await userEvent.setup().selectOptions(screen.getByLabelText('Misión'), MISSION_2.id);
    await screen.findByRole('heading', { name: 'LUNA' });

    const missionIds = calls
      .filter((c) => pathOf(c) === '/admin/dashboard/crew')
      .map((c) => queryOf(c).get('mission_id'));
    expect(missionIds).toEqual([MISSION.id, MISSION_2.id]);
    expect(queryClient.getQueryData(queryKeys.crewDashboard(MISSION.id))).toBeUndefined();
    expect(storage.getSelectedMissionId()).toBe(MISSION_2.id);
    // Todas las consultas de datos llevan mission_id.
    for (const call of calls.filter((c) => ['/admin/dashboard/crew', '/admin/inbox', '/missions/current'].includes(pathOf(c)))) {
      expect(queryOf(call).get('mission_id')).toBeTruthy();
    }
  });
});

describe('estado del enlace', () => {
  it('enlace activo: retraso, entorno y gravedad en texto', () => {
    const summary = summarizeLink(currentMission('up') as CurrentMission, NOW);
    expect(summary).toEqual({
      tone: 'up',
      headline: 'Enlace activo · retraso 90 s',
      next: '',
      environment: 'Tránsito a Marte · 0 g',
    });
  });

  it('sin enlace: corte en curso hasta hh:mm y el próximo corte', () => {
    const data = currentMission('down') as CurrentMission;
    data.comm.upcoming_outages = [
      { id: 'o2', mission_id: MISSION.id, starts_at: '2026-11-14T22:00:00Z', ends_at: '2026-11-14T23:30:00Z', reason: 'Mantenimiento de antena' },
      { id: 'o0', mission_id: MISSION.id, starts_at: '2026-11-14T06:00:00Z', ends_at: '2026-11-14T07:00:00Z', reason: 'Ya pasó' },
    ];
    const summary = summarizeLink(data, NOW);
    expect(summary.tone).toBe('down');
    expect(summary.headline).toBe('Sin enlace · corte en curso hasta las 20:00');
    expect(summary.next).toBe('Próximo corte: 22:00–23:30 · Mantenimiento de antena');
  });

  it('la cabecera lo muestra con texto (GET /missions/current?mission_id=)', async () => {
    const { calls } = renderApp('/tripulacion', 'flight_surgeon', (call) => {
      const path = pathOf(call);
      if (path === '/missions/current') return json(200, currentMission('up'));
      if (path === '/admin/dashboard/crew') return json(200, dashboard([]));
      if (path === '/indicators') return json(200, catalog());
      if (path === '/admin/inbox') return json(200, { items: [], next_cursor: null });
      return undefined;
    });
    expect(await screen.findByText(/Enlace activo · retraso 90 s/)).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.some((c) => pathOf(c) === '/missions/current' && queryOf(c).get('mission_id') === MISSION.id)).toBe(true),
    );
    expect(calls.some((c) => pathOf(c).startsWith('/admin/comm-outages'))).toBe(false);
  });
});
