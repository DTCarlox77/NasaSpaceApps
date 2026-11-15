/**
 * Marco del panel: cabecera (misión, estado del enlace, usuario y rol, cerrar sesión, aviso de
 * emergencia abierta y, en modo demo, la cinta "sin servidor"), barra lateral solo con las
 * secciones del rol y el contenido.
 */
import { Suspense, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/context.ts';
import { canSee, sectionsFor } from '../nav/access.ts';
import { RoleBadge } from '../components/RoleBadge.tsx';
import { useUnacknowledgedCount } from '../features/alerts/useInbox.ts';
import { Button } from '../components/Button.tsx';
import { DemoRibbon } from '../components/DemoRibbon.tsx';
import { Loading } from '../components/QueryStatus.tsx';
import { useMission } from '../mission/useMission.ts';
import { EmergencyAlert } from './EmergencyAlert.tsx';
import { LinkStatus } from './LinkStatus.tsx';
import './AppShell.css';

function MissionPicker() {
  const { mission, missions, selectMission } = useMission();
  if (missions.length === 0) {
    return <span className="shell-mission muted">Sin misión asignada</span>;
  }
  if (missions.length === 1) {
    return (
      <span className="shell-mission">
        Misión <strong>{mission?.code}</strong>
      </span>
    );
  }
  return (
    <label className="shell-mission">
      Misión
      <select value={mission?.id ?? ''} onChange={(e) => selectMission(e.target.value)}>
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

/** Contador de la barra lateral: alertas que ya llegaron y siguen sin acuse (cada 15 s). */
function AlertsBadge() {
  const { role } = useAuth();
  const pending = useUnacknowledgedCount(canSee(role, 'alerts'));
  if (!pending || pending.count === 0) return null;
  const text = pending.more ? `${pending.count}+` : String(pending.count);
  return (
    <span className="nav-badge">
      {text}
      <span className="visually-hidden"> sin acuse</span>
    </span>
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
        <DemoRibbon />
        <div className="shell-brand">
          <span className="shell-brand-mark" aria-hidden="true">
            ◎
          </span>
          Panel de Tierra
        </div>
        <MissionPicker />
        <LinkStatus />
        <span className="shell-synthetic">Datos sintéticos · Apoyo a la decisión, no diagnóstico</span>
        <div className="shell-user">
          <span className="shell-user-name">
            <strong>{auth.user?.full_name}</strong>
            {auth.role ? <RoleBadge role={auth.role} /> : null}
          </span>
          <Button variant="ghost" onClick={() => void onSignOut()} loading={leaving}>
            Cerrar sesión
          </Button>
        </div>
        <EmergencyAlert />
      </header>
      <nav className="shell-sidebar" aria-label="Secciones">
        <ul>
          {sections.map((s) => (
            <li key={s.id}>
              <NavLink to={s.path} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                <span className="nav-title">{s.title}</span>
                {s.id === 'alerts' ? <AlertsBadge /> : null}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main id="contenido" className="shell-main" tabIndex={-1}>
        {/* Las pantallas con datos se cargan por ruta (React.lazy). */}
        <Suspense fallback={<Loading label="Cargando la sección…" />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
