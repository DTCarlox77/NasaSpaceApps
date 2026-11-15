/**
 * Cambio de contraseña obligatorio (428 PASSWORD_CHANGE_REQUIRED): POST /auth/change-password
 * con Bearer = details.password_change_token. Responde como un login.
 */
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth/context.ts';
import { Banner } from '../components/Banner.tsx';
import { Button } from '../components/Button.tsx';
import { Field } from '../components/Field.tsx';

export const MIN_PASSWORD_LENGTH = 10;

export function ChangePasswordPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (auth.status === 'authenticated' && auth.role) {
    return <Navigate to="/" replace />;
  }
  if (!auth.pendingPasswordChange) return <Navigate to="/login" replace />;

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== next;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!current) return setError('Escribe tu contraseña actual (la temporal).');
    if (next.length < MIN_PASSWORD_LENGTH) {
      return setError(`La contraseña nueva debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    }
    if (next !== confirm) return setError('La confirmación no coincide con la contraseña nueva.');
    if (next === current) return setError('La contraseña nueva debe ser distinta de la actual.');
    setBusy(true);
    setError(null);
    const result = await auth.completePasswordChange(current, next);
    setBusy(false);
    if (result.kind === 'error') setError(result.message);
  }

  return (
    <div className="center-screen">
      <section className="card" aria-labelledby="change-title">
        <header className="card-header">
          <p className="eyebrow">Primer inicio de sesión</p>
          <h1 id="change-title">Cambia tu contraseña</h1>
          <p className="muted">
            La cuenta <strong>{auth.pendingPasswordChange.username}</strong> tiene una contraseña
            temporal. Elige una nueva para continuar.
          </p>
        </header>
        <form className="stack" onSubmit={onSubmit} noValidate>
          {error ? <Banner tone="error">{error}</Banner> : null}
          <Field
            label="Contraseña actual (temporal)"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            disabled={busy}
          />
          <Field
            label="Contraseña nueva"
            type="password"
            autoComplete="new-password"
            hint={`Al menos ${MIN_PASSWORD_LENGTH} caracteres y distinta de la actual.`}
            error={tooShort ? `Faltan ${MIN_PASSWORD_LENGTH - next.length} caracteres.` : null}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            disabled={busy}
          />
          <Field
            label="Confirma la contraseña nueva"
            type="password"
            autoComplete="new-password"
            error={mismatch ? 'No coincide con la contraseña nueva.' : null}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
          />
          <Button type="submit" block loading={busy}>
            Cambiar contraseña y entrar
          </Button>
          <Button
            variant="ghost"
            block
            disabled={busy}
            onClick={() => {
              auth.cancelPasswordChange();
              navigate('/login');
            }}
          >
            Volver al inicio de sesión
          </Button>
        </form>
      </section>
    </div>
  );
}
