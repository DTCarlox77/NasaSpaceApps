import { useState } from 'react';
import { Alert, StyleSheet, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppText, Avatar, Button, Card, FadeInView, IconButton, PressableScale, ProgressBar, Screen } from '@/presentation/components/ui';
import { MissionCard } from '@/presentation/features/auth/MissionStep';
import { useCrew } from '@/presentation/hooks/useCrew';
import { useCurrentMission, useMissions } from '@/presentation/hooks/useMissions';
import { useAuthStore } from '@/presentation/store/authStore';
import { useProfileStore } from '@/presentation/store/profileStore';
import { useSettingsStore } from '@/presentation/store/settingsStore';
import { showToast } from '@/presentation/store/toastStore';

/** Perfil y misión (Figma "Profile & mission"): foto, datos del astronauta, misión actual y sesión. */
export default function ProfileScreen() {
  const compact = useWindowDimensions().width < 420;
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const { session, signOut } = useAuthStore();
  const { photoUri, setPhoto, removePhoto } = useProfileStore();
  const missions = useMissions();
  const current = useCurrentMission();
  const setSelectedMissionId = useSettingsStore((s) => s.setSelectedMissionId);
  const [changing, setChanging] = useState(false);
  const name = session?.displayName ?? '';
  const { me } = useCrew();

  const pick = async (from: 'library' | 'camera') => {
    const perm =
      from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showToast({ level: 'caution', title: t('profile.permissionTitle'), body: t('profile.permissionBody') });
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 };
    const res = from === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (res.canceled || !res.assets[0]) return;
    try {
      await setPhoto(res.assets[0].uri);
      showToast({ level: 'normal', title: t('profile.photoSaved'), body: t('profile.photoSavedBody') });
    } catch {
      showToast({ level: 'caution', title: t('profile.photoError'), body: '' });
    }
  };

  return (
    <Screen>
      <FadeInView style={[styles.row, { gap: spacing.md }]}>
        <IconButton icon="arrow-back" tone="filled" accessibilityLabel={t('common.back')} onPress={() => router.back()} />
        <AppText variant="h1" style={styles.flex}>{t('profile.title')}</AppText>
      </FadeInView>

      {/* Foto + identidad */}
      <FadeInView index={1}>
        <Card style={[styles.center, { gap: spacing.md }]}>
          <View>
            <Avatar name={name} size={104} />
            <PressableScale
              accessibilityLabel={t('profile.changePhoto')}
              onPress={() =>
                Alert.alert(t('profile.changePhoto'), undefined, [
                  { text: t('profile.fromGallery'), onPress: () => pick('library') },
                  { text: t('profile.takePhoto'), onPress: () => pick('camera') },
                  ...(photoUri ? [{ text: t('profile.removePhoto'), style: 'destructive' as const, onPress: removePhoto }] : []),
                  { text: t('alert.cancel'), style: 'cancel' as const },
                ])
              }
              style={[styles.editBadge, { backgroundColor: colors.primary, borderColor: colors.surface }]}
            >
              <Ionicons name="camera" size={18} color={colors.onPrimary} />
            </PressableScale>
          </View>
          <View style={[styles.center, { gap: 2 }]}>
            <AppText variant="h2" align="center">{name}</AppText>
            {session && (
              <AppText color="textMuted" align="center">
                {t(`auth.roles.${session.role}`)} · {session.userId}
              </AppText>
            )}
          </View>
          {me && (
            // Pantalla angosta (p. ej. 360 dp): cuadrícula 2×2; ancha: una fila de 4.
            <View style={[styles.row, styles.wrap, { gap: spacing.sm, alignSelf: 'stretch' }]}>
              {[
                { icon: 'water' as const, value: me.bloodType, label: t('crew.bloodType'), tint: colors.status.critical.solid },
                { icon: 'calendar-outline' as const, value: t('crew.years', { count: me.age }), label: t('crew.age'), tint: colors.primaryText },
                { icon: 'resize-outline' as const, value: `${me.heightM.toFixed(2)} m`, label: t('crew.height'), tint: colors.primaryText },
                { icon: 'barbell-outline' as const, value: `${me.weightKg} kg`, label: t('crew.weight'), tint: colors.primaryText },
              ].map((f) => (
                <View key={f.label} style={[styles.center, compact ? styles.half : styles.flex, { gap: 2, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }]}>
                  <Ionicons name={f.icon} size={18} color={f.tint} />
                  <AppText variant="label" align="center" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{f.value}</AppText>
                  <AppText variant="caption" color="textMuted" align="center" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{f.label}</AppText>
                </View>
              ))}
            </View>
          )}
        </Card>
      </FadeInView>

      {/* Misión actual */}
      {current && (
        <FadeInView index={2}>
          <Card tone="night" style={{ gap: spacing.md }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Ionicons name="rocket-outline" size={18} color={colors.primary} />
              <AppText variant="label" style={[styles.flex, { color: colors.onNightMuted }]}>{t('mission.current')}</AppText>
              <View style={{ backgroundColor: colors.nightChip, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                <AppText variant="label" style={{ color: colors.primary, fontSize: 12 }}>{t(`mission.phase.${current.phase}`)}</AppText>
              </View>
            </View>
            <AppText variant="h2" style={{ color: colors.onNight }}>{current.name}</AppText>
            <AppText style={{ color: colors.onNightMuted }}>{current.vehicle}</AppText>
            <InfoRow label={t('mission.day')} value={t('mission.dayOf', { day: current.day, total: current.totalDays })} />
            <InfoRow label={t('mission.crew')} value={t('mission.crewCount', { count: current.crew })} />
            <InfoRow label={t('mission.location')} value={current.location} />
            <InfoRow label={t('profile.gravity')} value={`${current.gravity} g`} />
            <ProgressBar value={current.totalDays ? current.day / current.totalDays : 0} color={colors.primary} onDark />
            <Button
              label={changing ? t('profile.closeMissions') : t('profile.changeMission')}
              variant="primary"
              size="sm"
              leftIcon={changing ? 'chevron-up' : 'swap-horizontal'}
              onPress={() => setChanging((c) => !c)}
            />
          </Card>
        </FadeInView>
      )}

      {changing && (
        <FadeInView style={{ gap: spacing.md }}>
          {missions.map((m) => (
            <MissionCard
              key={m.id}
              mission={m}
              selected={m.id === current?.id}
              onPress={() => {
                if (m.phase !== 'active') {
                  showToast({ level: 'info', title: m.name, body: t('mission.notStarted') });
                  return;
                }
                setSelectedMissionId(m.id);
                setChanging(false);
                showToast({ level: 'normal', title: t('profile.missionChanged'), body: m.name });
              }}
            />
          ))}
        </FadeInView>
      )}

      {/* Sesión */}
      <FadeInView index={3}>
        <Card style={{ gap: spacing.md }}>
          <AppText variant="title">{t('profile.session')}</AppText>
          <Button label={t('settings.title')} variant="outline" leftIcon="settings-outline" fullWidth onPress={() => router.push('/settings')} />
          <Button label={t('settings.signOut')} variant="dark" leftIcon="log-out-outline" fullWidth onPress={signOut} />
        </Card>
      </FadeInView>
    </Screen>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.infoRow}>
      <AppText variant="bodySmall" style={{ color: colors.onNightMuted }}>{label}</AppText>
      <AppText variant="label" style={[styles.infoValue, { color: colors.onNight }]}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  half: { flexBasis: '47%', flexGrow: 1 },
  editBadge: { position: 'absolute', right: -2, bottom: -2, width: 36, height: 36, borderRadius: 18, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  infoValue: { flexShrink: 1, textAlign: 'right' },
});
