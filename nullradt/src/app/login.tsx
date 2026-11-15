import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import Animated, { FadeInRight, FadeOutLeft } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { Button } from '@/presentation/components/ui';
import { ChangePasswordStep } from '@/presentation/features/auth/ChangePasswordStep';
import { IdentifyStep } from '@/presentation/features/auth/IdentifyStep';
import { LOGIN_SHEET_OVERLAP, LoginHero } from '@/presentation/features/auth/LoginHero';
import { MissionStep } from '@/presentation/features/auth/MissionStep';
import { Stepper } from '@/presentation/features/auth/Stepper';
import { useAuthStore } from '@/presentation/store/authStore';
import { useSettingsStore } from '@/presentation/store/settingsStore';

/**
 * Login (Figma "Auth"): 1) Identificarse — biometría o ID de astronauta + contraseña; 2) Elegir misión.
 * Si se desbloquea con biometría y ya hay misión elegida, entra directo (re-bloqueo tras segundo plano).
 */
export default function LoginScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const insets = useSafeAreaInsets();
  const enterApp = useAuthStore((s) => s.enterApp);
  const hasMission = useSettingsStore((s) => !!s.selectedMissionId);
  const [step, setStep] = useState<0 | 1 | 'change'>(0);
  const mustChange = () => !!useAuthStore.getState().session?.mustChangePassword;
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);

  // Con el teclado abierto, sube el formulario para que el campo y el botón queden a la vista.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => scrollRef.current?.scrollToEnd({ animated: true }));
    return () => sub.remove();
  }, []);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}>
          <View style={{ paddingTop: insets.top, backgroundColor: colors.night }}>
            {/* Emergencia sin sesión: triaje en tabletas registradas (si no, SOS básico) */}
            <View style={[styles.sosRow, { paddingHorizontal: spacing.lg, paddingTop: spacing.sm }]}>
              <Button
                label={t('nav.sos')}
                leftIcon="megaphone"
                variant="danger"
                size="sm"
                onPress={() => router.push('/triage')}
              />
            </View>
            <LoginHero />
          </View>

          <View style={[styles.sheet, { backgroundColor: colors.background, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: spacing.xl, gap: spacing.xl }]}>
            <Stepper steps={[t('auth.steps.identify'), t('auth.steps.mission')]} current={step === 1 ? 1 : 0} label={t('auth.steps.label')} />

            {step === 0 ? (
              <Animated.View key="identify" entering={FadeInRight.duration(260)} exiting={FadeOutLeft.duration(180)}>
                <IdentifyStep onVerified={(method) => (mustChange() ? setStep('change') : method !== 'password' && hasMission ? enterApp() : setStep(1))} />
              </Animated.View>
            ) : step === 'change' ? (
              <Animated.View key="change" entering={FadeInRight.duration(260)} exiting={FadeOutLeft.duration(180)}>
                <ChangePasswordStep onDone={() => setStep(1)} />
              </Animated.View>
            ) : (
              <Animated.View key="mission" entering={FadeInRight.duration(260)} exiting={FadeOutLeft.duration(180)}>
                <MissionStep onBack={() => setStep(0)} onContinue={enterApp} />
              </Animated.View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sosRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  sheet: { marginTop: -LOGIN_SHEET_OVERLAP },
});
