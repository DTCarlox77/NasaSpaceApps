/**
 * Guarda de rutas: exige sesión y que el rol pueda ver la sección (nav/access.ts). Una ruta sin
 * permiso escrita a mano muestra ForbiddenPage en su lugar (no redirige en silencio).
 */
import type { ReactNode } from 'react';
import { useAuth } from './context.ts';
import { canSee, type SectionId } from '../nav/access.ts';
import { ForbiddenPage } from '../pages/ForbiddenPage.tsx';

export function RequireRole({ section, children }: { section: SectionId; children: ReactNode }) {
  const { role } = useAuth();
  if (!canSee(role, section)) return <ForbiddenPage />;
  return <>{children}</>;
}
