import '@/core/logbox';
import '@/core/i18n';
// La tarea en segundo plano debe definirse al cargar la app (también cuando el SO la despierta sin UI).
import '@/presentation/background/monitorTask';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { appFonts } from '@/core/fonts/fonts';
import { container } from '@/di/container';
import { AppThemeProvider, useAppTheme } from '@/core/theme';
import { BrandIntro } from '@/presentation/components/brand/BrandIntro';
import { ToastHost } from '@/presentation/components/feedback/ToastHost';
import { useAutoLock } from '@/presentation/hooks/useAutoLock';
import { useBackgroundMonitor } from '@/presentation/hooks/useBackgroundMonitor';
import { useForegroundNotifications } from '@/presentation/hooks/useForegroundNotifications';
import { useLanguageSync } from '@/presentation/hooks/useLanguageSync';
import { useNotificationSetup } from '@/presentation/hooks/useNotificationSetup';
import { useShakeToAlert } from '@/presentation/hooks/useShakeToAlert';
import { useSyncLoop } from '@/presentation/hooks/useSyncLoop';
import { useAuthStore } from '@/presentation/store/authStore';
import { useSettingsStore } from '@/presentation/store/settingsStore';

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Navegación protegida:
 * - signedOut / locked → login (locked ofrece huella / Face ID) · unlocked → app
 * - La alerta de emergencia queda FUERA de la protección: accesible siempre (seguridad > privacidad).
 */
function RootNavigator() {
  const { colors } = useAppTheme();
  const status = useAuthStore((s) => s.status);
  useShakeToAlert();
  useForegroundNotifications();
  useAutoLock();

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          // Transición estilo iOS (desliza desde la derecha con parallax) también en Android + gesto para volver.
          animation: 'ios_from_right',
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      >
        <Stack.Protected guard={status === 'unlocked'} redirectTo="/login">
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="voice-lab" />
          <Stack.Screen name="notifications-lab" />
          <Stack.Screen name="profile" />
          <Stack.Screen name="body-3d" />
          <Stack.Screen name="measure" />
          <Stack.Screen name="crew" />
          <Stack.Screen name="connectivity" />
          <Stack.Screen name="tests/index" />
          <Stack.Screen name="tests/reaction" />
          <Stack.Screen name="tests/vision" />
          <Stack.Screen name="tests/stroop" />
          <Stack.Screen name="tests/memory" />
          <Stack.Screen name="support" />
          <Stack.Screen name="screening" />
          {/* Triaje: necesita la sesión (Bearer) o el modo demo; el latido mantiene viva la sesión de emergencia. */}
          <Stack.Screen name="triage/[sessionId]/index" />
          <Stack.Screen name="triage/[sessionId]/assess/[astronautId]" options={{ gestureEnabled: false }} />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedOut' || status === 'locked'} redirectTo="/">
          <Stack.Screen name="login" options={{ animation: 'fade' }} />
        </Stack.Protected>
        <Stack.Screen
          name="alert"
          options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }}
        />
      </Stack>
      <ToastHost />
    </>
  );
}

function AppShell() {
  const { isDark } = useAppTheme();
  useLanguageSync();
  useNotificationSetup();
  useBackgroundMonitor();
  useSyncLoop();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <RootNavigator />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(appFonts);
  const hydrated = useSettingsStore((s) => s.hasHydrated);
  const authStatus = useAuthStore((s) => s.status);
  const ready = (fontsLoaded || !!fontError) && hydrated && authStatus !== 'loading';
  // Intro de marca solo en el arranque en frío; la app se monta debajo mientras tanto.
  const [introDone, setIntroDone] = useState(false);
  const finishIntro = useCallback(() => setIntroDone(true), []);

  useEffect(() => {
    // Despierta la API al abrir (Render gratuito se duerme ~50 s): GET /health con timeout de 60 s, sin bloquear.
    void container.wakeServer.execute();
    useAuthStore.getState().bootstrap().catch(() => useAuthStore.setState({ status: 'signedOut' }));
  }, []);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={styles.flex}>
      <AppThemeProvider>
        <AppShell />
        {!introDone && <BrandIntro onDone={finishIntro} />}
      </AppThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
