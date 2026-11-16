import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import {
  getPermissionState,
  openSystemSettings,
  requestPermission,
  sendSystemNotification,
  type AppNotification,
  type NotificationLevel,
  type PermissionState,
} from '@/core/notifications/notificationService';
import { AppText, Button, Card, IconButton, SegmentedControl } from '@/presentation/components/ui';
import { showToast } from '@/presentation/store/toastStore';

const LEVELS: NotificationLevel[] = ['info', 'normal', 'caution', 'critical'];

/** Laboratorio para generar notificaciones de prueba (in-app y del sistema). */
export default function NotificationsLabScreen() {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const [level, setLevel] = useState<NotificationLevel>('caution');
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionState | null>(null);

  useEffect(() => {
    getPermissionState().then(setPermission).catch(() => {});
  }, []);

  const sample = (l: NotificationLevel): AppNotification => ({
    level: l,
    title: t(`notificationsLab.samples.${l}.title`),
    body: t(`notificationsLab.samples.${l}.body`),
  });

  const sendSystem = async (delay: number) => {
    await sendSystemNotification(sample(level), delay);
    setLastSent(delay > 0 ? t('notificationsLab.scheduled', { seconds: delay }) : t('notificationsLab.sentNow'));
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.huge }}>
        <View style={[styles.row, { gap: spacing.md }]}>
          <IconButton icon="arrow-back" tone="filled" accessibilityLabel={t('alert.close')} onPress={() => router.back()} />
          <AppText variant="h2" style={styles.flex}>{t('notificationsLab.title')}</AppText>
        </View>

        {permission && (
          <Card tone={permission === 'granted' ? 'tinted' : 'alt'} style={{ gap: spacing.sm }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Ionicons
                name={permission === 'granted' ? 'checkmark-circle' : 'alert-circle'}
                size={20}
                color={permission === 'granted' ? colors.primaryText : colors.accentText}
              />
              <AppText variant="title" style={styles.flex}>{t('permissions.title')}</AppText>
            </View>
            <AppText variant="bodySmall" color={permission === 'granted' ? 'textSecondary' : 'accentText'}>
              {permission === 'granted' ? t('permissions.granted') : permission === 'blocked' ? t('permissions.blocked') : t('permissions.denied')}
            </AppText>
            {permission !== 'granted' && (
              <Button
                label={permission === 'blocked' ? t('permissions.openSettings') : t('permissions.allow')}
                variant="outline"
                onPress={async () => (permission === 'blocked' ? openSystemSettings() : setPermission(await requestPermission()))}
              />
            )}
          </Card>
        )}

        <View style={{ gap: spacing.sm }}>
          <AppText variant="title">{t('notificationsLab.level')}</AppText>
          <SegmentedControl<NotificationLevel>
            value={level}
            onChange={setLevel}
            options={LEVELS.map((l) => ({ value: l, label: t(`notificationsLab.levels.${l}`) }))}
          />
        </View>

        <Card style={{ gap: spacing.md }}>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Ionicons name="phone-portrait-outline" size={22} color={colors.primaryText} />
            <AppText variant="h3" style={styles.flex}>{t('notificationsLab.inAppTitle')}</AppText>
          </View>
          <AppText variant="bodySmall" color="textSecondary">{t('notificationsLab.inAppBody')}</AppText>
          <View style={[styles.row, { gap: spacing.sm, flexWrap: 'wrap' }]}>
            <Button label={t('notificationsLab.showInApp')} icon="arrow-down" onPress={() => showToast(sample(level))} />
            <Button label={t('notificationsLab.burst')} variant="outline" onPress={() => LEVELS.forEach((l) => showToast(sample(l)))} />
          </View>
        </Card>

        <Card style={{ gap: spacing.md }}>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Ionicons name="notifications-outline" size={22} color={colors.primaryText} />
            <AppText variant="h3" style={styles.flex}>{t('notificationsLab.systemTitle')}</AppText>
          </View>
          <AppText variant="bodySmall" color="textSecondary">{t('notificationsLab.systemBody')}</AppText>
          <View style={[styles.row, { gap: spacing.sm, flexWrap: 'wrap' }]}>
            <Button label={t('notificationsLab.sendNow')} icon="send" onPress={() => sendSystem(0)} />
            <Button label={t('notificationsLab.sendIn5')} variant="outline" icon="time-outline" onPress={() => sendSystem(5)} />
          </View>
          {lastSent && <AppText variant="caption" color="textMuted">{lastSent}</AppText>}
        </Card>

        <AppText variant="caption" color="textMuted">{t('notificationsLab.footer')}</AppText>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
