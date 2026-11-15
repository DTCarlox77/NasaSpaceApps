import { useEffect, useRef } from 'react';
import { Accelerometer } from 'expo-sensors';

export interface ShakeOptions {
  /** Aceleración extra (en g, sobre la gravedad) que cuenta como sacudida. */
  threshold?: number;
  /** Picos necesarios dentro de la ventana para disparar. */
  peaks?: number;
  windowMs?: number;
  /** Tiempo mínimo entre disparos. */
  cooldownMs?: number;
  enabled?: boolean;
}

/**
 * Detecta "agitar el teléfono" con el acelerómetro.
 * Exige varios picos seguidos para evitar falsos positivos al caminar o guardar el teléfono.
 */
export function useShakeDetector(onShake: () => void, options: ShakeOptions = {}) {
  const { threshold = 1.4, peaks = 3, windowMs = 900, cooldownMs = 2500, enabled = true } = options;
  const callback = useRef(onShake);
  callback.current = onShake;

  useEffect(() => {
    if (!enabled) return;
    let peakTimes: number[] = [];
    let lastPeak = 0;
    let lastFired = 0;
    let sub: { remove: () => void } | undefined;
    let cancelled = false;

    Accelerometer.isAvailableAsync().then((available) => {
      if (!available || cancelled) return;
      Accelerometer.setUpdateInterval(60);
      sub = Accelerometer.addListener(({ x, y, z }) => {
        const now = Date.now();
        const delta = Math.abs(Math.sqrt(x * x + y * y + z * z) - 1); // quitar 1 g de gravedad
        if (delta < threshold || now - lastPeak < 120) return; // un pico no se cuenta dos veces
        lastPeak = now;
        peakTimes = [...peakTimes.filter((t) => now - t < windowMs), now];
        if (peakTimes.length >= peaks && now - lastFired > cooldownMs) {
          lastFired = now;
          peakTimes = [];
          callback.current();
        }
      });
    });

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [threshold, peaks, windowMs, cooldownMs, enabled]);
}
