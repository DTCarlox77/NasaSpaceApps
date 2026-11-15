import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { createQueryClient } from '../api/queryClient.ts';
import * as storage from '../auth/storage.ts';
import { ASTRONAUT_MESSAGE, localTime } from '../auth/messages.ts';
import { routes } from '../routes.tsx';
import { apiError, groundContext, json, loginResponse, mockFetch, user } from './helpers.ts';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

async function submitLogin(username: string, password = 'Demo2026!') {
  const ui = userEvent.setup();
  await ui.type(screen.getByLabelText('Usuario'), username);
  await ui.type(screen.getByLabelText('Contraseña'), password);
  await ui.click(screen.getByRole('button', { name: 'Entrar' }));
  return ui;
}

beforeEach(() => {
  storage.clearSession();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  storage.clearSession();
});

describe('login', () => {
  it('un astronauta se rechaza con el mensaje de "usa la app" (y se cierra su sesión)', async () => {
    const { calls } = mockFetch((call) =>
      call.path === '/auth/login' ? json(200, loginResponse('astronaut', 'a.ortega')) : json(204, undefined),
    );
    renderAt('/login');
    await submitLogin('a.ortega');

    expect(await screen.findByText(ASTRONAUT_MESSAGE)).toBeInTheDocument();
    const logout = calls.find((c) => c.path === '/auth/logout');
    expect(logout?.auth).toBe('Bearer at_astronaut');
    expect(logout?.body).toEqual({ device_id: storage.getDeviceId() });
    expect(storage.loadSession()).toBeNull();
    expect(storage.getAccessToken()).toBeNull();
  });

  it('423 muestra la hora de desbloqueo en hora local', async () => {
    const lockedUntil = '2026-11-14T08:30:00Z';
    mockFetch(() =>
      apiError(423, 'ACCOUNT_LOCKED', 'Cuenta bloqueada', { locked_until: lockedUntil }),
    );
    renderAt('/login');
    await submitLogin('dr.reyes');
    expect(
      await screen.findByText(
        `Cuenta bloqueada hasta las ${localTime(lockedUntil)}. Pide a control de misión que la desbloquee.`,
      ),
    ).toBeInTheDocument();
  });

  it('401 INVALID_CREDENTIALS: siempre "Usuario o contraseña incorrectos"', async () => {
    mockFetch(() => apiError(401, 'INVALID_CREDENTIALS', 'texto del servidor que no se usa'));
    renderAt('/login');
    await submitLogin('no.existe', 'cualquiera');
    expect(await screen.findByText('Usuario o contraseña incorrectos.')).toBeInTheDocument();
  });

  it('red caída: "No se pudo conectar con el servidor"', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    renderAt('/login');
    await submitLogin('dr.reyes');
    expect(await screen.findByText('No se pudo conectar con el servidor.')).toBeInTheDocument();
  });

  it('428 → cambio de contraseña con el password_change_token como Bearer', async () => {
    const { calls } = mockFetch((call) => {
      if (call.path === '/auth/login') {
        return apiError(428, 'PASSWORD_CHANGE_REQUIRED', 'Cambia', {
          password_change_token: 'pct_123',
          expires_in: 600,
        });
      }
      if (call.path === '/auth/change-password') return json(200, loginResponse('admin', 'nuevo.admin'));
      return json(200, {});
    });
    const router = renderAt('/login');
    const ui = await submitLogin('nuevo.admin', 'Temporal-123');

    expect(await screen.findByRole('heading', { name: 'Cambia tu contraseña' })).toBeInTheDocument();
    await ui.type(screen.getByLabelText('Contraseña actual (temporal)'), 'Temporal-123');
    await ui.type(screen.getByLabelText('Contraseña nueva'), 'corta');
    await ui.type(screen.getByLabelText('Confirma la contraseña nueva'), 'corta');
    await ui.click(screen.getByRole('button', { name: 'Cambiar contraseña y entrar' }));
    expect(await screen.findByText(/al menos 10 caracteres/)).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/auth/change-password')).toBe(false);

    await ui.clear(screen.getByLabelText('Contraseña nueva'));
    await ui.clear(screen.getByLabelText('Confirma la contraseña nueva'));
    await ui.type(screen.getByLabelText('Contraseña nueva'), 'Nueva-Clave-2026');
    await ui.type(screen.getByLabelText('Confirma la contraseña nueva'), 'Nueva-Clave-2026');
    await ui.click(screen.getByRole('button', { name: 'Cambiar contraseña y entrar' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/tripulacion'));
    const change = calls.find((c) => c.path === '/auth/change-password');
    expect(change?.auth).toBe('Bearer pct_123');
    expect(change?.body).toEqual({
      current_password: 'Temporal-123',
      new_password: 'Nueva-Clave-2026',
      device_id: storage.getDeviceId(),
    });
  });
});

describe('navegación por rol en el panel', () => {
  it('admin entra al Dashboard y ve sus secciones (nada conductual)', async () => {
    mockFetch(() => json(200, loginResponse('admin', 'mission.control')));
    const router = renderAt('/login');
    await submitLogin('mission.control');

    await waitFor(() => expect(router.state.location.pathname).toBe('/tripulacion'));
    const nav = screen.getByRole('navigation', { name: 'Secciones' });
    const links = Array.from(nav.querySelectorAll('a .nav-title')).map((a) => a.textContent);
    expect(links).toEqual(['Dashboard de tripulación', 'Alertas', 'Emergencias', 'Cumplimiento', 'Demo']);
    expect(screen.getByText('Datos sintéticos · Apoyo a la decisión, no diagnóstico')).toBeInTheDocument();
    expect(screen.getByText('ARES-1')).toBeInTheDocument();
  });

  it('behavioral_health entra a Salud conductual; una URL ajena muestra "Sin acceso"', async () => {
    mockFetch(() => json(200, loginResponse('behavioral_health', 'bh.salas')));
    const router = renderAt('/login');
    await submitLogin('bh.salas');
    await waitFor(() => expect(router.state.location.pathname).toBe('/salud-conductual'));

    await act(() => router.navigate('/cumplimiento'));
    expect(await screen.findByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument();
    expect(screen.getByText('Tu rol no tiene acceso a esta sección.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/cumplimiento'); // no redirige en silencio
  });

  it('al recargar, el refresh_token recupera la sesión; cerrar sesión la borra', async () => {
    storage.saveSession({
      refresh_token: 'rt_saved',
      user: user('flight_surgeon'),
      context: groundContext(),
    });
    const { calls } = mockFetch((call) => {
      if (call.path === '/auth/refresh') {
        return json(200, { access_token: 'at_2', token_type: 'Bearer', expires_in: 900, refresh_token: 'rt_2' });
      }
      return json(204, undefined);
    });
    const router = renderAt('/alertas');

    expect(await screen.findByRole('heading', { name: 'Alertas' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
    expect(storage.getRefreshToken()).toBe('rt_2');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    const logout = calls.find((c) => c.path === '/auth/logout');
    expect(logout?.auth).toBe('Bearer at_2');
    expect(storage.loadSession()).toBeNull();
    expect(sessionStorage.getItem('astro-panel.session')).toBeNull();
  });

  it('al recargar sin red: "Reintentar" y la sesión no se borra', async () => {
    storage.saveSession({
      refresh_token: 'rt_saved',
      user: user('flight_surgeon'),
      context: groundContext(),
    });
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    renderAt('/tripulacion');
    expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(storage.getRefreshToken()).toBe('rt_saved');
  });
});
