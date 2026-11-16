import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildOverview, type HealthOverview } from '@/domain/usecases/GetHealthOverview';
import { container } from '@/di/container';
import { classify } from '@/domain/rules/ruleEngine';
import { SEX_DEPENDENT_RULES } from '@/domain/rules/sexReference';
import { biometricsOf } from '@/presentation/hooks/useMyBiometrics';
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

  const session = useAuthStore((s) => s.session);
  const me = biometricsOf(userId);
  // Con API el sexo lo da el servidor (context.sex); en demo, la ficha sintética.
  const sex = session?.sex ?? me?.sex;
  const mock = base?.snapshot.origin === 'mock';
  // Solo maqueta: reglas que dependen del sexo (calcio urinario, fuerza de agarre) sobre la última lectura.
  // Con API manda la evaluación del servidor (esos indicadores quedan "sin evaluar", INTEGRACION.md §4).
  const sexAware = useMemo(
    () =>
      base?.snapshot.indicators.map((ind) =>
        mock && SEX_DEPENDENT_RULES.includes(ind.id) && ind.latest
          ? { ...ind, status: classify(ind.id, ind.latest.value, ind.latest.secondaryValue, ind.trend.slice(0, -1), sex ?? undefined).status }
          : ind,
      ) ?? [],
    [base, sex, mock],
  );
  const overview = useMemo(
    () => (base ? buildOverview({ ...base.snapshot, indicators: applyLocalReadings(sexAware, local, !mock) }) : null),
    [base, sexAware, local, mock],
  );
  // `baseIndicators` = datos sin las mediciones locales (para construir el historial sin duplicar puntos).
  return { overview, baseIndicators: sexAware, localReadings: local ?? [], sex, error, reload: load };
}
