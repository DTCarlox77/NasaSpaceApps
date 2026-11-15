/** Estados comunes de una consulta: cargando, error (con Reintentar) y "actualizado hace X". */
import { describeError, HttpError } from '../api/http.ts';
import { timeAgo } from '../lib/time.ts';
import { Banner } from './Banner.tsx';
import { Button } from './Button.tsx';
import { Spinner } from './Spinner.tsx';

export function Loading({ label }: { label: string }) {
  return (
    <div className="row muted" role="status">
      <Spinner label="" /> {label}
    </div>
  );
}

/** Mensaje de error de una pantalla de datos. 403/404 no se reintentan (no cambiarían). */
function errorMessage(error: unknown): string {
  if (error instanceof HttpError && error.status === 404) {
    return 'No se encontró la misión o ya no tienes acceso a ella.';
  }
  return describeError(error);
}

export function QueryError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const retryable = !(error instanceof HttpError && error.status < 500);
  return (
    <div className="stack">
      <Banner tone="error">{errorMessage(error)}</Banner>
      {retryable && onRetry ? (
        <div>
          <Button variant="secondary" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** "Actualizado hace X" con aviso si la última actualización falló. */
export function UpdatedAgo({
  updatedAt,
  now,
  failed,
  fetching,
}: {
  updatedAt: number;
  now: number;
  failed: boolean;
  fetching: boolean;
}) {
  const ago = updatedAt ? timeAgo(new Date(updatedAt).toISOString(), now) : '';
  return (
    <span className="updated-ago">
      Actualizado {ago}
      {fetching ? ' · actualizando…' : ''}
      {failed ? ' · ⚠ no se pudo actualizar; datos anteriores' : ''}
    </span>
  );
}
