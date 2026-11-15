/** Monta el panel completo con una sesión ya guardada (recargar → refresh) y fetch simulado. */
import { render } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { createQueryClient } from '../api/queryClient.ts';
import type { GroundRole, UserContext } from '../api/types.ts';
import * as storage from '../auth/storage.ts';
import { routes } from '../routes.tsx';
import { groundContext, json, mockFetch, user, type Call } from './helpers.ts';

type Handler = (call: Call) => Response | Promise<Response> | undefined;

/**
 * `handler` responde las rutas de datos; el refresh, el logout y lo que no conteste se
 * responden aquí (refresh → tokens nuevos; resto → 404).
 */
export function renderApp(
  path: string,
  role: GroundRole,
  handler: Handler,
  context: UserContext = groundContext(),
) {
  storage.saveSession({ refresh_token: 'rt_saved', user: user(role), context });
  const fetched = mockFetch(async (call) => {
    if (call.path === '/auth/refresh') {
      return json(200, { access_token: 'at_1', token_type: 'Bearer', expires_in: 900, refresh_token: 'rt_1' });
    }
    if (call.path === '/auth/logout') return json(204, undefined);
    const response = await handler(call);
    return response ?? json(404, { error: { code: 'NOT_FOUND', message: 'no simulado' } });
  });
  const queryClient: QueryClient = createQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient, ...fetched };
}
