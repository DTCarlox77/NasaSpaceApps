import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/context.ts';
import { canOpenPath } from '../nav/access.ts';
import { Banner } from '../components/Banner.tsx';
import { Button } from '../components/Button.tsx';
import { DemoRibbon, DemoUsersHint } from '../components/DemoRibbon.tsx';
import { Field } from '../components/Field.tsx';

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (auth.status === 'authenticated' && auth.role) {
    const from = (location.state as { from?: string } | null)?.from;
    // Vuelve a donde estaba solo si su rol puede verlo (otra persona pudo entrar después).
    return <Navigate to={from && canOpenPath(auth.role, from) ? from : '/'} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError('Escribe tu usuario y tu contraseña.');
      return;
    }
    setBusy(true);
    setError(null);
    auth.clearNotice();
    const result = await auth.signIn(username.trim().toLowerCase(), password);
    setBusy(false);
    if (result.kind === 'error') {
      setError(result.message);
      setPassword('');
    } else if (result.kind === 'password_change') {
      navigate('/cambiar-contrasena');
    }
  }

  return (
    <div className="center-screen">
      <section className="card" aria-labelledby="login-title">
        <DemoRibbon />
        <header className="card-header">
          <p className="eyebrow">Control de misión · Panel de Tierra</p>
          <h1 id="login-title">Iniciar sesión</h1>
          <p className="muted">Para control de misión, flight surgeon y salud conductual.</p>
        </header>
        <form className="stack" onSubmit={onSubmit} noValidate>
          {auth.notice ? <Banner tone="warning">{auth.notice}</Banner> : null}
          {error ? <Banner tone="error">{error}</Banner> : null}
          <Field
            label="Usuario"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
          />
          <Field
            label="Contraseña"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <Button type="submit" block loading={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
        <p className="synthetic-note">Datos sintéticos · Apoyo a la decisión, no diagnóstico</p>
        <DemoUsersHint />
      </section>
    </div>
  );
}
