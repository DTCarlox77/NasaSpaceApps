/**
 * Modo demo sin servidor de punta a punta (VITE_DATA_MODE=mock): el panel entero funciona con el
 * adaptador de src/api/mock/ y nunca llama a fetch (ni a /health).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { configureMock, resetMockState } from '../api/mock/server.ts';
import { createQueryClient } from '../api/queryClient.ts';
import * as storage from '../auth/storage.ts';
import { ASTRONAUT_MESSAGE } from '../auth/messages.ts';
import { DEMO_RIBBON_TEXT } from '../components/DemoRibbon.tsx';
import { WakeGate } from '../pages/WakeGate.tsx';
import { resetWakeState } from '../pages/wakeState.ts';
import { routes } from '../routes.tsx';

let fetchSpy: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  await import('../features/crew/CrewDashboardPage.tsx');
  await import('../features/behavioral/BehavioralInboxPage.tsx');
}, 30_000);

beforeEach(() => {
  vi.stubEnv('VITE_DATA_MODE', 'mock');
  configureMock({ latencyMs: 0 });
  resetMockState();
  fetchSpy = vi.fn(() => Promise.reject(new Error('fetch no debe usarse en modo demo')));
  vi.stubGlobal('fetch', fetchSpy);
  storage.clearSession();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  storage.clearSession();
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

async function login(username: string) {
  const ui = userEvent.setup();
  await ui.type(screen.getByLabelText('Usuario'), username);
  await ui.type(screen.getByLabelText('Contraseña'), 'cualquiera');
  await ui.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('modo demo sin servidor', () => {
  it('WakeGate no llama a /health', () => {
    resetWakeState();
    render(
      <WakeGate>
        <p>listo</p>
      </WakeGate>,
    );
    expect(screen.getByText('listo')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('dr.reyes entra con cualquier contraseña: cinta, dashboard y aviso de emergencia, sin red', async () => {
    const router = renderAt('/login');
    expect(screen.getByText(DEMO_RIBBON_TEXT)).toBeInTheDocument();
    await login('dr.reyes');
    await waitFor(() => expect(router.state.location.pathname).toBe('/tripulacion'));
    expect(await screen.findByText(/Emergencia abierta en ARES-1/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'LYRA' })).toBeInTheDocument();
    expect(screen.getByText(DEMO_RIBBON_TEXT)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('bh.salas entra a Salud conductual con la bandeja del demo', async () => {
    const router = renderAt('/login');
    await login('bh.salas');
    await waitFor(() => expect(router.state.location.pathname).toBe('/salud-conductual'));
    expect(await screen.findByRole('list', { name: 'Bandeja confidencial' })).toBeInTheDocument();
    expect(screen.queryByText(/Emergencia abierta/)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('un astronauta se rechaza igual que con la API', async () => {
    renderAt('/login');
    await login('l.tanaka');
    expect(await screen.findByText(ASTRONAUT_MESSAGE)).toBeInTheDocument();
    expect(storage.loadSession()).toBeNull();
  });
});
