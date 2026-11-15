import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { apiEnabled } from '@/core/config/env';
import { useAuthStore } from '@/presentation/store/authStore';
import { refreshPendingCount, runSync } from '@/presentation/sync/syncEngine';

/** Cada cuánto se sincroniza mientras la app está abierta y hay enlace (guía §3: "cada pocos minutos"). */
const INTERVAL_MS = 3 * 60_000;

/**
 * Ciclo de sincronización: al entrar a la app, al reconectar la red, al volver a primer plano
 * y cada 3 minutos. Sin API (modo demo) no hace nada.
 */
export function useSyncLoop() {
  const status = useAuthStore((s) => s.status);
  const active = apiEnabled() && status === 'unlocked';

  useEffect(() => {
    if (!active) return;
    void runSync();
    const timer = setInterval(() => void runSync(), INTERVAL_MS);
    const net = Network.addNetworkStateListener((s) => {
      if (s.isConnected && s.isInternetReachable !== false) void runSync();
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') void runSync();
    });
    void refreshPendingCount();
    return () => {
      clearInterval(timer);
      net.remove();
      app.remove();
    };
  }, [active]);
}
