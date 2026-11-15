/**
 * Despertar del servidor: al abrir el panel, GET /api/v1/health (timeout 60 s). En Render el
 * plan gratuito se duerme y el primer pedido tarda ~50 s. Una vez por carga de la página.
 * En modo demo sin servidor (VITE_DATA_MODE=mock) no hay servidor que despertar: no llama a /health.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { getHealth, WAKE_TIMEOUT_MS } from '../api/health.ts';
import { HttpError, NetworkError } from '../api/http.ts';
import { isMockMode } from '../config/env.ts';
import { Banner } from '../components/Banner.tsx';
import { Button } from '../components/Button.tsx';
import { Spinner } from '../components/Spinner.tsx';
import { isAwake, markAwake } from './wakeState.ts';

type Phase = 'waking' | 'ready' | 'failed';

function failureMessage(err: unknown): string {
  if (err instanceof NetworkError && err.timeout) {
    return `El servidor no respondió en ${WAKE_TIMEOUT_MS / 1000} s.`;
  }
  if (err instanceof NetworkError) return 'No se pudo conectar con el servidor.';
  if (err instanceof HttpError && err.status === 503) {
    return 'El servidor respondió, pero su base de datos no está disponible.';
  }
  return 'El servidor respondió con un error.';
}

export function WakeGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>(isAwake() || isMockMode() ? 'ready' : 'waking');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (phase !== 'waking') return;
    const controller = new AbortController();
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    getHealth({ signal: controller.signal })
      .then((health) => {
        if (health.status === 'ok') {
          markAwake();
          setPhase('ready');
        } else {
          setError('El servidor respondió, pero su base de datos no está disponible.');
          setPhase('failed');
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(failureMessage(err));
        setPhase('failed');
      })
      .finally(() => clearInterval(timer));
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [phase, attempt]);

  const retry = useCallback(() => {
    setElapsed(0);
    setError(null);
    setPhase('waking');
    setAttempt((n) => n + 1);
  }, []);

  if (phase === 'ready') return <>{children}</>;

  return (
    <div className="center-screen">
      <section className="card stack" aria-labelledby="wake-title">
        <div>
          <p className="eyebrow">Panel de Tierra</p>
          <h1 id="wake-title">
            {phase === 'waking' ? 'Conectando con el servidor' : 'No hay conexión con el servidor'}
          </h1>
        </div>
        {phase === 'waking' ? (
          <div className="row" aria-live="polite">
            <Spinner large label="Despertando el servidor" />
            <p className="muted" style={{ margin: 0 }}>
              Despertando el servidor… (el plan gratuito tarda ~50 s)
              <br />
              <strong>{elapsed} s</strong>
            </p>
          </div>
        ) : (
          <>
            <Banner tone="error">{error}</Banner>
            <Button onClick={retry}>Reintentar</Button>
          </>
        )}
      </section>
    </div>
  );
}
