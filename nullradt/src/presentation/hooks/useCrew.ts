import { useEffect, useState } from 'react';
import type { CrewMember } from '@/domain/entities/Crew';
import { container } from '@/di/container';
import { useAuthStore } from '@/presentation/store/authStore';

/** Tripulación de la misión y el tripulante de la sesión actual. */
export function useCrew() {
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const userId = useAuthStore((s) => s.session?.userId);
  useEffect(() => {
    let alive = true;
    container.getCrew.execute().then((c) => alive && setCrew(c));
    return () => {
      alive = false;
    };
  }, []);
  const me = crew.find((c) => c.id === userId) ?? null;
  return { crew, me, others: crew.filter((c) => c.id !== userId) };
}
