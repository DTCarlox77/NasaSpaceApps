import type { RouteObject } from 'react-router';
import { RequireRole } from './auth/RequireRole.tsx';
import { SessionGate } from './auth/SessionGate.tsx';
import { AppShell } from './layout/AppShell.tsx';
import { SECTIONS } from './nav/access.ts';
import { ChangePasswordPage } from './pages/ChangePasswordPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { HomeRedirect, RootRoute } from './pages/RootRoute.tsx';
import { SectionPlaceholder } from './pages/SectionPlaceholder.tsx';

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
                <SectionPlaceholder id={section.id} />
              </RequireRole>
            ),
          })),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
