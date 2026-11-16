import { crewMockDataSource } from '@/data/datasources/mock/crewMockDataSource';
import type { Sex } from '@/domain/rules/sexReference';
import { useAuthStore } from '@/presentation/store/authStore';

/**
 * Sexo y edad del tripulante de la sesión (rangos de referencia por sexo).
 * El sexo del servidor (`context.sex`) manda; la edad es de la ficha (sintética para cuentas del servidor).
 * null = no es la sesión actual ni un tripulante de la maqueta.
 */
export function biometricsOf(userId: string | undefined): { sex: Sex; age: number } | null {
  if (!userId) return null;
  const session = useAuthStore.getState().session;
  const m = session?.userId === userId ? crewMockDataSource.profileFor(session) : crewMockDataSource.findById(userId);
  return m ? { sex: session?.userId === userId && session.sex ? session.sex : m.sex, age: m.age } : null;
}

export function useMyBiometrics() {
  const session = useAuthStore((s) => s.session);
  const m = crewMockDataSource.profileFor(session);
  return m ? { sex: session?.sex ?? m.sex, age: m.age } : null;
}
