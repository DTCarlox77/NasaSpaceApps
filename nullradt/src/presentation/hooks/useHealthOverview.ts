import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildOverview, type HealthOverview } from '@/domain/usecases/GetHealthOverview';
import { container } from '@/di/container';
import { useAuthStore } from '@/presentation/store/authStore';
import { applyLocalReadings, useHealthLogStore } from '@/presentation/store/healthLogStore';

/**
 * Resumen de salud (indicadores + sistemas). Viene del backend, de la caché offline o de la maqueta,
 * y encima se aplican las mediciones tomadas en el dispositivo (offline-first).
 */
export function useHealthOverview() {
  const [base, setBase] = useState<HealthOverview | null>(null);
  const [error, setError] = useState(false);
  const userId = useAuthStore((s) => s.session?.userId ?? '');
  const local = useHealthLogStore((s) => s.readings[userId]);

  const load = useCallback(() => {
    container.getHealthOverview
      .execute()
      .then((o) => {
        setError(false);
        setBase(o);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(load, [load]);

  const overview = useMemo(
    () => (base ? buildOverview({ ...base.snapshot, indicators: applyLocalReadings(base.snapshot.indicators, local) }) : null),
    [base, local],
  );
  return { overview, error, reload: load };
}
