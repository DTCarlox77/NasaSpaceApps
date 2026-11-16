import { useEffect, useState } from 'react';
import type { MissionStatus } from '@/domain/entities/Mission';
import { container } from '@/di/container';

export function useMissionStatus() {
  const [status, setStatus] = useState<MissionStatus | null>(null);
  useEffect(() => {
    let alive = true;
    container.getMissionStatus.execute().then((data) => alive && setStatus(data));
    return () => {
      alive = false;
    };
  }, []);
  return status;
}
