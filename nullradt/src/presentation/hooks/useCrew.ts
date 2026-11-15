import { useCallback, useEffect, useState } from 'react';
import type { CrewMember, CrewStatusResult, RosterMember, RosterMission } from '@/domain/entities/Crew';
import { container } from '@/di/container';
import { crewMockDataSource } from '@/data/datasources/mock/crewMockDataSource';
import { useAuthStore } from '@/presentation/store/authStore';
import { useSyncStore } from '@/presentation/store/syncStore';

/** Tripulación de la maqueta (solo modo demo; con API devuelve []) y el tripulante de la sesión actual. */
export function useCrew() {
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const session = useAuthStore((s) => s.session);
  const userId = session?.userId;
  useEffect(() => {
    let alive = true;
    container.getCrew.execute().then((c) => alive && setCrew(c));
    return () => {
      alive = false;
    };
  }, []);
  // Con API la lista viene vacía: el perfil usa la ficha sintética de relleno (estatura, peso, edad, sangre).
  const me = crew.find((c) => c.id === userId) ?? crewMockDataSource.profileFor(session);
  return { crew, me, others: crew.filter((c) => c.id !== userId) };
}

/**
 * Con API: roster real (GET /missions/current + /missions/{id}/crew) y estado de salud de la tripulación
 * SOLO por GET /api/v1/crew/status (sin bienestar; `physical` solo para el oficial médico).
 */
export function useCrewRoster() {
  const [roster, setRoster] = useState<{ mission: RosterMission; members: RosterMember[] } | null>(null);
  const [status, setStatus] = useState<CrewStatusResult | null>(null);
  const syncVersion = useSyncStore((s) => s.version);

  const load = useCallback(() => {
    container.getCrewRoster.execute().then(setRoster).catch(() => setRoster(null));
    container.getCrewStatus.execute().then(setStatus).catch(() => setStatus({ status: 'offline' }));
  }, []);

  useEffect(() => {
    load();
  }, [load, syncVersion]);

  return { roster, status, reload: load };
}
