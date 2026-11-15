import { crewMockDataSource } from '@/data/datasources/mock/crewMockDataSource';
import type { Sex } from '@/domain/rules/sexReference';
import { useAuthStore } from '@/presentation/store/authStore';

/** Sexo y edad del tripulante de la sesión (para rangos de referencia por sexo). null = cuenta sin ficha (personal de Tierra). */
export function biometricsOf(userId: string | undefined): { sex: Sex; age: number } | null {
  const m = userId ? crewMockDataSource.findById(userId) : null;
  return m ? { sex: m.sex, age: m.age } : null;
}

export function useMyBiometrics() {
  const userId = useAuthStore((s) => s.session?.userId);
  return biometricsOf(userId);
}
