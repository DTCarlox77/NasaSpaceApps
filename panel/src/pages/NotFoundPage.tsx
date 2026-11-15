import { Link } from 'react-router';
import { useAuth } from '../auth/context.ts';
import { homePathFor } from '../nav/access.ts';

export function NotFoundPage() {
  const { role } = useAuth();
  return (
    <section className="page stack" aria-labelledby="notfound-title">
      <h1 id="notfound-title">Página no encontrada</h1>
      <p className="muted">Esa dirección no existe en el panel.</p>
      <p>
        <Link to={homePathFor(role)}>Ir a mi sección inicial</Link>
      </p>
    </section>
  );
}
