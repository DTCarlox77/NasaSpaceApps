import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildOverview, type HealthOverview } from '@/domain/usecases/GetHealthOverview';
import { container } from '@/di/container';
import { classify } from '@/domain/rules/ruleEngine';
import { SEX_DEPENDENT_RULES } from '@/domain/rules/sexReference';
import { biometricsOf } from '@/presentation/hooks/useMyBiometrics';
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

  const me = biometricsOf(userId);
  const sex = me?.sex;
  // Reglas que dependen del sexo (calcio urinario, fuerza de agarre): se reevalúa la última lectura de la maqueta.
  const sexAware = useMemo(
    () =>
      base?.snapshot.indicators.map((ind) =>
        SEX_DEPENDENT_RULES.includes(ind.id) && ind.latest
          ? { ...ind, status: classify(ind.id, ind.latest.value, ind.latest.secondaryValue, ind.trend.slice(0, -1), sex).status }
          : ind,
      ) ?? [],
    [base, sex],
  );
  const overview = useMemo(
    () => (base ? buildOverview({ ...base.snapshot, indicators: applyLocalReadings(sexAware, local) }) : null),
    [base, sexAware, local],
  );
  // `baseIndicators` = datos sin las mediciones locales (para construir el historial sin duplicar puntos).
  return { overview, baseIndicators: sexAware, localReadings: local ?? [], sex, error, reload: load };
}
