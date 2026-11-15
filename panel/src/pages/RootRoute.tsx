import { Navigate, Outlet } from 'react-router';
import { AuthProvider } from '../auth/AuthProvider.tsx';
import { useAuth } from '../auth/context.ts';
import { homePathFor } from '../nav/access.ts';

/** Raíz del router: la sesión vive dentro (las pantallas usan useNavigate). */
export function RootRoute() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

/** "/" → la sección inicial del rol. */
export function HomeRedirect() {
  const { role } = useAuth();
  return <Navigate to={homePathFor(role)} replace />;
}
