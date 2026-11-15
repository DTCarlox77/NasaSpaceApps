/**
 * Exige una sesión del equipo en Tierra. Mientras se recupera (refresh al recargar) muestra
 * un aviso; si la red falla, "Reintentar" (la sesión no se cierra); sin sesión, al login.
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './context.ts';
import { Banner } from '../components/Banner.tsx';
import { Button } from '../components/Button.tsx';
import { Spinner } from '../components/Spinner.tsx';

export function SessionGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'restoring') {
    return (
      <div className="center-screen">
        <section className="card stack" aria-live="polite">
          {auth.restoreError ? (
            <>
              <Banner tone="error">{auth.restoreError}</Banner>
              <Button onClick={auth.retryRestore}>Reintentar</Button>
            </>
          ) : (
            <div className="row">
              <Spinner large label="Recuperando tu sesión" />
              <p className="muted" style={{ margin: 0 }}>
                Recuperando tu sesión…
              </p>
            </div>
          )}
        </section>
      </div>
    );
  }
  if (auth.status !== 'authenticated' || !auth.role) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
