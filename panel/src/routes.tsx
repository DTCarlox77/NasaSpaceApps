import { lazy, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { RequireRole } from './auth/RequireRole.tsx';
import { SessionGate } from './auth/SessionGate.tsx';
import { AppShell } from './layout/AppShell.tsx';
import { SECTIONS, type SectionId } from './nav/access.ts';
import { ChangePasswordPage } from './pages/ChangePasswordPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { HomeRedirect, RootRoute } from './pages/RootRoute.tsx';
import { SectionPlaceholder } from './pages/SectionPlaceholder.tsx';

// Carga diferida por ruta: Recharts (y cada pantalla con datos) va en su propio chunk.
const CrewDashboardPage = lazy(() =>
  import('./features/crew/CrewDashboardPage.tsx').then((m) => ({ default: m.CrewDashboardPage })),
);
const AstronautDetailPage = lazy(() =>
  import('./features/crew/AstronautDetailPage.tsx').then((m) => ({ default: m.AstronautDetailPage })),
);

/** Pantallas ya implementadas; el resto sigue como placeholder de su fase. */
const PAGES: Partial<Record<SectionId, ReactNode>> = {
  crew: <CrewDashboardPage />,
};

/** Rutas hijas de una sección (detalle), protegidas con el mismo rol que la sección. */
const SUBROUTES: { section: SectionId; path: string; element: ReactNode }[] = [
  { section: 'crew', path: '/tripulacion/:astronautId', element: <AstronautDetailPage /> },
];

/** Rutas del panel (también las usan las pruebas con un router en memoria). */
export const routes: RouteObject[] = [
  {
    element: <RootRoute />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/cambiar-contrasena', element: <ChangePasswordPage /> },
      {
        element: (
          <SessionGate>
            <AppShell />
          </SessionGate>
        ),
        children: [
          { index: true, element: <HomeRedirect /> },
          ...SECTIONS.map((section) => ({
            path: section.path,
            element: (
              <RequireRole section={section.id}>
                {PAGES[section.id] ?? <SectionPlaceholder id={section.id} />}
              </RequireRole>
            ),
          })),
          ...SUBROUTES.map((sub) => ({
            path: sub.path,
            element: <RequireRole section={sub.section}>{sub.element}</RequireRole>,
          })),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
