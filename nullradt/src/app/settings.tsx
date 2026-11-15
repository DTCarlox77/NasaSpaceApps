import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppText, Button, Card, FadeInView, IconButton, Screen, SegmentedControl, ToggleRow } from '@/presentation/components/ui';
import { useBiometrics } from '@/presentation/hooks/useBiometrics';
import { useMonitorStore } from '@/presentation/hooks/useBackgroundMonitor';
import { useAuthStore } from '@/presentation/store/authStore';
import { showToast } from '@/presentation/store/toastStore';
import { Disclaimer } from '@/presentation/components/feedback/Disclaimer';
import {
  useSettingsStore,
  type LanguagePreference,
  type ThemePreference,
} from '@/presentation/store/settingsStore';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { spacing, colors, radius } = useAppTheme();
  const { themePreference, languagePreference, setThemePreference, setLanguagePreference } = useSettingsStore();
  const { session, biometricEnabled, setBiometricEnabled, signOut } = useAuthStore();
  const biometrics = useBiometrics();
  const monitor = useMonitorStore((m) => m.state);

  const toggleBiometric = async (next: boolean) => {
    if (!next) return setBiometricEnabled(false);
    // Activar exige confirmar con el sensor, así se comprueba que funciona.
    const res = await biometrics.authenticate();
    if (res.ok) {
      await setBiometricEnabled(true);
      showToast({ level: 'normal', title: t('auth.biometricSaved', { method: biometrics.methodLabel }), body: t('auth.biometricSavedBody') });
    }
  };

  return (
    <Screen>
      <FadeInView style={[styles.row, { gap: spacing.md }]}>
        <IconButton icon="arrow-back" tone="filled" accessibilityLabel={t('common.back')} onPress={() => router.back()} />
        <AppText variant="h1" style={styles.flex}>{t('settings.title')}</AppText>
      </FadeInView>

      <FadeInView index={1}>
        <Card style={{ gap: spacing.lg }}>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <AppText variant="title" style={styles.flex}>{t('settings.security')}</AppText>
          </View>
          {session && (
            <AppText variant="bodySmall" color="textSecondary">{t('settings.signedInAs', { name: session.displayName })}</AppText>
          )}
          <ToggleRow
            icon={biometrics.icon}
            title={t('auth.saveBiometric', { method: biometrics.methodLabel })}
            description={
              biometrics.available
                ? t('settings.biometricHint')
                : biometrics.capability?.hasHardware
                  ? t('auth.biometricNotEnrolled')
                  : t('auth.biometricNoHardware')
            }
            value={biometricEnabled}
            onValueChange={toggleBiometric}
            disabled={!biometrics.available && !biometricEnabled}
          />
          <Button label={t('settings.signOut')} variant="outline" icon="log-out-outline" onPress={signOut} />
        </Card>
      </FadeInView>

      <FadeInView index={2}>
        <Card style={[styles.row, { gap: spacing.md }]}>
          <View style={[styles.iconBubble, { backgroundColor: colors.surfaceTinted, borderRadius: radius.md }]}>
            <Ionicons name={monitor === 'active' ? 'pulse' : 'pause-circle-outline'} size={22} color={colors.primaryText} />
          </View>
          <View style={styles.flex}>
            <AppText variant="title">{t('background.title')}</AppText>
            <AppText variant="bodySmall" color={monitor === 'active' ? 'primaryText' : 'textSecondary'}>
              {monitor ? t(`background.state.${monitor}`) : '…'}
            </AppText>
          </View>
        </Card>
      </FadeInView>

      <FadeInView index={2}>
        <Card style={{ gap: spacing.md }}>
          <AppText variant="title">{t('settings.appearance')}</AppText>
          <SegmentedControl<ThemePreference>
            value={themePreference}
            onChange={setThemePreference}
            options={[
              { value: 'system', label: t('settings.system') },
              { value: 'light', label: t('settings.light') },
              { value: 'dark', label: t('settings.dark') },
            ]}
          />
        </Card>
      </FadeInView>

      <FadeInView index={3}>
        <Card style={{ gap: spacing.md }}>
          <AppText variant="title">{t('settings.language')}</AppText>
          <SegmentedControl<LanguagePreference>
            value={languagePreference}
            onChange={setLanguagePreference}
            options={[
              { value: 'system', label: t('settings.system') },
              { value: 'es', label: t('settings.spanish') },
              { value: 'en', label: t('settings.english') },
            ]}
          />
        </Card>
      </FadeInView>

      <FadeInView index={4}>
        <Card onPress={() => router.push('/voice-lab')} accessibilityLabel={t('settings.voiceLab')} style={[styles.row, { gap: spacing.md }]}>
          <View style={[styles.iconBubble, { backgroundColor: colors.surfaceTinted, borderRadius: radius.md }]}>
            <Ionicons name="mic-outline" size={22} color={colors.primaryText} />
          </View>
          <View style={styles.flex}>
            <AppText variant="title">{t('settings.voiceLab')}</AppText>
            <AppText variant="bodySmall" color="textSecondary">{t('settings.voiceLabBody')}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Card>
      </FadeInView>

      <FadeInView index={5}>
        <Card onPress={() => router.push('/notifications-lab')} accessibilityLabel={t('settings.notificationsLab')} style={[styles.row, { gap: spacing.md }]}>
          <View style={[styles.iconBubble, { backgroundColor: colors.surfaceTinted, borderRadius: radius.md }]}>
            <Ionicons name="notifications-outline" size={22} color={colors.primaryText} />
          </View>
          <View style={styles.flex}>
            <AppText variant="title">{t('settings.notificationsLab')}</AppText>
            <AppText variant="bodySmall" color="textSecondary">{t('settings.notificationsLabBody')}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Card>
      </FadeInView>

      <FadeInView index={6}>
        <Card tone="tinted" style={{ gap: spacing.xs }}>
          <AppText variant="title">{t('settings.about')}</AppText>
          <AppText variant="bodySmall" color="textSecondary">{t('settings.aboutBody')}</AppText>
        </Card>
      </FadeInView>

      <View>
        <Disclaimer />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  iconBubble: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
