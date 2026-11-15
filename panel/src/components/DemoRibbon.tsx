/** Cinta fija del modo demo sin servidor (VITE_DATA_MODE=mock). Nada en el modo api. */
import { isMockMode } from '../config/env.ts';

export const DEMO_RIBBON_TEXT = 'Modo demo sin servidor · datos sintéticos';

export function DemoRibbon() {
  if (!isMockMode()) return null;
  return (
    <div className="demo-ribbon" role="note">
      <span aria-hidden="true">◆</span> {DEMO_RIBBON_TEXT}
    </div>
  );
}

/** Usuarios del modo demo (cualquier contraseña no vacía). */
export function DemoUsersHint() {
  if (!isMockMode()) return null;
  return (
    <div className="demo-users">
      <p>
        <strong>Usuarios demo</strong> (cualquier contraseña):
      </p>
      <ul>
        <li>
          <code>mission.control</code> · control de misión
        </li>
        <li>
          <code>dr.reyes</code> · flight surgeon
        </li>
        <li>
          <code>bh.salas</code> · salud conductual
        </li>
      </ul>
    </div>
  );
}
