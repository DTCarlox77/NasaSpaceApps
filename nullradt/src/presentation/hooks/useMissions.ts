import { useEffect, useState } from 'react';
import type { Mission } from '@/domain/entities/Mission';
import { container } from '@/di/container';
import { useSettingsStore } from '@/presentation/store/settingsStore';

export function useMissions() {
  const [missions, setMissions] = useState<Mission[]>([]);
  useEffect(() => {
    let alive = true;
    container.getMissions.execute().then((data) => alive && setMissions(data));
    return () => {
      alive = false;
    };
  }, []);
  return missions;
}

/** Misión actualmente seleccionada (o la activa por defecto). */
export function useCurrentMission() {
  const missions = useMissions();
  const selectedId = useSettingsStore((s) => s.selectedMissionId);
  return missions.find((m) => m.id === selectedId) ?? missions.find((m) => m.phase === 'active') ?? null;
}
