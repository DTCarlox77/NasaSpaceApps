import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { createQueryClient } from './api/queryClient.ts';
import { WakeGate } from './pages/WakeGate.tsx';
import { routes } from './routes.tsx';

const router = createBrowserRouter(routes);

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
