import { Link } from 'react-router';
import { useAuth } from '../auth/context.ts';
import { homePathFor } from '../nav/access.ts';
import { Banner } from '../components/Banner.tsx';

export function ForbiddenPage() {
  const { role } = useAuth();
  return (
    <section className="page stack" aria-labelledby="forbidden-title">
      <h1 id="forbidden-title">Sin acceso</h1>
      <Banner tone="warning">Tu rol no tiene acceso a esta sección.</Banner>
      <p>
        <Link to={homePathFor(role)}>Ir a mi sección inicial</Link>
      </p>
    </section>
  );
}
