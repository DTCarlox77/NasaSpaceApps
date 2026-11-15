import { useEffect, useState } from 'react';

/** Hora actual (ms) que se actualiza cada `intervalMs`: para "hace X" y cuentas regresivas. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
