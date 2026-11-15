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
const AlertsPage = lazy(() =>
  import('./features/alerts/AlertsPage.tsx').then((m) => ({ default: m.AlertsPage })),
);
const AstronautDetailPage = lazy(() =>
  import('./features/crew/AstronautDetailPage.tsx').then((m) => ({ default: m.AstronautDetailPage })),
);
const EmergenciesPage = lazy(() =>
  import('./features/emergencies/EmergenciesPage.tsx').then((m) => ({ default: m.EmergenciesPage })),
);
const EmergencyDetailPage = lazy(() =>
  import('./features/emergencies/EmergencyDetailPage.tsx').then((m) => ({ default: m.EmergencyDetailPage })),
);
// Salud conductual: solo behavioral_health (RequireRole muestra "Sin acceso" a los demás).
const BehavioralInboxPage = lazy(() =>
  import('./features/behavioral/BehavioralInboxPage.tsx').then((m) => ({ default: m.BehavioralInboxPage })),
);
const BehavioralAstronautPage = lazy(() =>
  import('./features/behavioral/BehavioralAstronautPage.tsx').then((m) => ({ default: m.BehavioralAstronautPage })),
);
const ConfidentialAuditPage = lazy(() =>
  import('./features/behavioral/ConfidentialAuditPage.tsx').then((m) => ({ default: m.ConfidentialAuditPage })),
);

// Equipo y Cumplimiento: solo admin.
const TeamPage = lazy(() => import('./features/team/TeamPage.tsx').then((m) => ({ default: m.TeamPage })));
const CompliancePage = lazy(() =>
  import('./features/compliance/CompliancePage.tsx').then((m) => ({ default: m.CompliancePage })),
);

/** Pantallas ya implementadas; el resto sigue como placeholder de su fase. */
const PAGES: Partial<Record<SectionId, ReactNode>> = {
  crew: <CrewDashboardPage />,
  alerts: <AlertsPage />,
  emergencies: <EmergenciesPage />,
  team: <TeamPage />,
  compliance: <CompliancePage />,
  behavioral: <BehavioralInboxPage />,
};

/** Rutas hijas de una sección (detalle), protegidas con el mismo rol que la sección. */
const SUBROUTES: { section: SectionId; path: string; element: ReactNode }[] = [
  { section: 'crew', path: '/tripulacion/:astronautId', element: <AstronautDetailPage /> },
  { section: 'emergencies', path: '/emergencias/:emergencyId', element: <EmergencyDetailPage /> },
  { section: 'behavioral', path: '/salud-conductual/astronauta/:astronautId', element: <BehavioralAstronautPage /> },
  { section: 'behavioral', path: '/salud-conductual/auditoria', element: <ConfidentialAuditPage /> },
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
