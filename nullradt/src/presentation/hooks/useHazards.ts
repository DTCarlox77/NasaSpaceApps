import { useEffect, useState } from 'react';
import type { Hazard } from '@/domain/entities/Hazard';
import { container } from '@/di/container';

export function useHazards() {
  const [hazards, setHazards] = useState<Hazard[]>([]);
  useEffect(() => {
    let alive = true;
    container.getHazards.execute().then((data) => alive && setHazards(data));
    return () => {
      alive = false;
    };
  }, []);
  return hazards;
}
