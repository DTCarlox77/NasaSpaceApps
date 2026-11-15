import { QueryClient } from '@tanstack/react-query';
import { HttpError, NetworkError } from './http.ts';

/**
 * React Query: no reintenta los errores del cliente (401, 403, 404 y demás 4xx); los de red y
 * los 5xx, hasta 2 veces. Sin refetch al volver a la ventana.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof HttpError && error.status < 500) return false;
  if (error instanceof NetworkError || error instanceof HttpError) return failureCount < 2;
  return false;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}
