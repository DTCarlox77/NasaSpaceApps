/**
 * Marco del panel: cabecera (misión, estado del enlace, usuario y rol, cerrar sesión), barra
 * lateral solo con las secciones del rol y el contenido.
 */
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/context.ts';
import { ROLE_LABELS, sectionsFor } from '../nav/access.ts';
import { Button } from '../components/Button.tsx';
import './AppShell.css';

function MissionPicker() {
  const auth = useAuth();
  const missions = auth.context?.ground_missions ?? [];
  if (missions.length === 0) {
    return <span className="shell-mission muted">Sin misión asignada</span>;
  }
  if (missions.length === 1) {
    return (
      <span className="shell-mission">
        Misión <strong>{auth.mission?.code}</strong>
      </span>
    );
  }
  return (
    <label className="shell-mission">
      Misión
      <select value={auth.mission?.id ?? ''} onChange={(e) => auth.selectMission(e.target.value)}>
        {missions.map((m) => (
          <option key={m.id} value={m.id}>
            {m.code}
            {m.status !== 'active' ? ` (${m.status})` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AppShell() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const sections = sectionsFor(auth.role);

  async function onSignOut() {
    setLeaving(true);
    await auth.signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <header className="shell-header">
        <div className="shell-brand">
          <span className="shell-brand-mark" aria-hidden="true">
            ◎
          </span>
          Panel de Tierra
        </div>
        <MissionPicker />
        {/* P2: estado del enlace con la nave (retraso y cortes). */}
        <span className="shell-link" aria-label="Estado del enlace: se muestra en P2">
          Enlace: —
        </span>
        <span className="shell-synthetic">Datos sintéticos · Apoyo a la decisión, no diagnóstico</span>
        <div className="shell-user">
          <span>
            <strong>{auth.user?.full_name}</strong>
            <br />
            <span className="muted">{auth.role ? ROLE_LABELS[auth.role] : ''}</span>
          </span>
          <Button variant="ghost" onClick={() => void onSignOut()} loading={leaving}>
            Cerrar sesión
          </Button>
        </div>
      </header>
      <nav className="shell-sidebar" aria-label="Secciones">
        <ul>
          {sections.map((s) => (
            <li key={s.id}>
              <NavLink to={s.path} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                {s.title}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main id="contenido" className="shell-main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
