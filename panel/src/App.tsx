import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';
import { createQueryClient } from './api/queryClient.ts';
import { AuthProvider } from './auth/AuthProvider.tsx';
import { SessionGate } from './auth/SessionGate.tsx';
import { useAuth } from './auth/context.ts';
import { Button } from './components/Button.tsx';
import { ChangePasswordPage } from './pages/ChangePasswordPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { WakeGate } from './pages/WakeGate.tsx';

function Root() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

function Home() {
  const auth = useAuth();
  return (
    <main className="center-screen">
      <section className="card stack">
        <h1>Hola, {auth.user?.full_name}</h1>
        <p className="muted">Rol: {auth.role}</p>
        <Button variant="secondary" onClick={() => void auth.signOut()}>
          Cerrar sesión
        </Button>
      </section>
    </main>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/cambiar-contrasena', element: <ChangePasswordPage /> },
      {
        path: '/',
        element: (
          <SessionGate>
            <Home />
          </SessionGate>
        ),
      },
    ],
  },
]);

export default function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <WakeGate>
        <RouterProvider router={router} />
      </WakeGate>
    </QueryClientProvider>
  );
}
