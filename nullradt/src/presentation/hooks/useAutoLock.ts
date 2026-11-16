import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '@/presentation/store/authStore';

/** Vuelve a bloquear la app si estuvo en segundo plano más de `graceMs` (solo con biometría activa). */
export function useAutoLock(graceMs = 30_000) {
  const backgroundAt = useRef<number | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundAt.current = Date.now();
      if (state === 'active' && backgroundAt.current) {
        if (Date.now() - backgroundAt.current > graceMs) useAuthStore.getState().lock();
        backgroundAt.current = null;
      }
    });
    return () => sub.remove();
  }, [graceMs]);
}
