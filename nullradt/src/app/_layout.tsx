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
import { AppThemeProvider, useAppTheme } from '@/core/theme';
import { BrandIntro } from '@/presentation/components/brand/BrandIntro';
import { ToastHost } from '@/presentation/components/feedback/ToastHost';
import { useAutoLock } from '@/presentation/hooks/useAutoLock';
import { useTokenRefresh } from '@/presentation/hooks/useTokenRefresh';
import { useVoiceAssistant } from '@/presentation/features/voice/useVoiceAssistant';
import { VoiceOverlay } from '@/presentation/features/voice/VoiceOverlay';
import { DeadManSwitch, markActivity } from '@/presentation/features/triage/DeadManSwitch';
import { useDeviceStore } from '@/presentation/store/deviceStore';
import { useBackgroundMonitor } from '@/presentation/hooks/useBackgroundMonitor';
import { useForegroundNotifications } from '@/presentation/hooks/useForegroundNotifications';
import { useLanguageSync } from '@/presentation/hooks/useLanguageSync';
import { useNotificationSetup } from '@/presentation/hooks/useNotificationSetup';
import { useShakeToAlert } from '@/presentation/hooks/useShakeToAlert';
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
  useTokenRefresh();
  useVoiceAssistant();

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
          <Stack.Screen name="indicator/[id]" />
          <Stack.Screen name="register" />
          <Stack.Screen name="measure-session" />
          <Stack.Screen name="voice-commands" />
          <Stack.Screen name="achievements" />
          <Stack.Screen name="comms" />
          <Stack.Screen name="earth" />
          <Stack.Screen name="access/index" />
          <Stack.Screen name="wellbeing/screening" />
          <Stack.Screen name="wellbeing/talk" />
          <Stack.Screen name="wellbeing/privacy" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedOut' || status === 'locked'} redirectTo="/">
          <Stack.Screen name="login" options={{ animation: 'fade' }} />
        </Stack.Protected>
        {/* Triaje: con sesión, o SIN sesión en tabletas registradas (credencial de dispositivo). */}
        <Stack.Screen name="triage/index" options={{ gestureEnabled: false }} />
        <Stack.Screen name="triage/assess" />
        <Stack.Screen
          name="alert"
          options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }}
        />
      </Stack>
      <VoiceOverlay />
      <DeadManSwitch />
      <ToastHost />
    </>
  );
}

function AppShell() {
  const { isDark } = useAppTheme();
  useLanguageSync();
  useNotificationSetup();
  useBackgroundMonitor();
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
    useAuthStore.getState().bootstrap().catch(() => useAuthStore.setState({ status: 'signedOut' }));
    useDeviceStore.getState().ensure().catch(() => {});
  }, []);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    // Cualquier toque cuenta como actividad para el interruptor de hombre muerto del triaje.
    <GestureHandlerRootView style={styles.flex} onTouchStart={markActivity}>
      <AppThemeProvider>
        <AppShell />
        {!introDone && <BrandIntro onDone={finishIntro} />}
      </AppThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
