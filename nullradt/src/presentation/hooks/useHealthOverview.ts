import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildOverview, type HealthOverview } from '@/domain/usecases/GetHealthOverview';
import { container } from '@/di/container';
import { useAuthStore } from '@/presentation/store/authStore';
import { applyLocalReadings, useHealthLogStore } from '@/presentation/store/healthLogStore';
import { useSyncStore } from '@/presentation/store/syncStore';

/**
 * Resumen de salud (indicadores + sistemas). Viene del backend, de la caché offline o de la maqueta,
 * y encima se aplican las mediciones del dispositivo aún no reflejadas por el servidor (offline-first).
 * Se recarga cuando la sincronización trae cambios.
 */
export function useHealthOverview() {
  const [base, setBase] = useState<HealthOverview | null>(null);
  const [error, setError] = useState(false);
  const userId = useAuthStore((s) => s.session?.userId ?? '');
  const local = useHealthLogStore((s) => s.readings[userId]);
  const syncVersion = useSyncStore((s) => s.version);

  const load = useCallback(() => {
    container.getHealthOverview
      .execute()
      .then((o) => {
        setError(false);
        setBase(o);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load, syncVersion]);

  const overview = useMemo(
    () =>
      base
        ? buildOverview({
            ...base.snapshot,
            indicators: applyLocalReadings(base.snapshot.indicators, local, base.snapshot.origin !== 'mock'),
          })
        : null,
    [base, local],
  );
  return { overview, error, reload: load };
}
