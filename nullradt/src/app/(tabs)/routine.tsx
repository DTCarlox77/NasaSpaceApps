import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { cancelReminder, requestPermission, scheduleDailyReminder } from '@/core/notifications/notificationService';
import { AppText, Card, FadeInView, PressableScale, ProgressBar, Screen } from '@/presentation/components/ui';
import { showToast } from '@/presentation/store/toastStore';
import { ROUTINE, todayKey, useRoutineStore, type RoutineItem } from '@/presentation/store/routineStore';

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/** Ítems que abren una pantalla de la app al tocarlos. */
const ACTION: Partial<Record<string, () => void>> = {
  dailyCheck: () => router.navigate('/wellbeing'),
  vitals: () => router.push({ pathname: '/measure', params: { indicator: 'bloodPressure' } }),
  brainTests: () => router.push('/tests' as Href),
  eyes: () => router.push('/tests/vision'),
};

/** Rutina diaria con recordatorios locales (funciona sin conexión). */
export default function RoutineScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const { done, reminders, toggleDone, setReminder } = useRoutineStore();
  const today = done[todayKey()] ?? [];
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nextItem = ROUTINE.find((i) => toMinutes(i.time) >= nowMin && !today.includes(i.id));
  const progress = today.filter((id) => ROUTINE.some((i) => i.id === id)).length / ROUTINE.length;

  const toggleReminder = async (item: RoutineItem, on: boolean) => {
    if (!on) {
      const nid = reminders[item.id];
      if (nid) await cancelReminder(nid);
      setReminder(item.id, null);
      return;
    }
    const perm = await requestPermission();
    if (perm !== 'granted') {
      showToast({ level: 'caution', title: t('routine.permissionTitle'), body: t('routine.permissionBody') });
      return;
    }
    const [h, m] = item.time.split(':').map(Number);
    try {
      const nid = await scheduleDailyReminder(t(`routine.items.${item.id}.title` as never), t('routine.reminderBody', { time: item.time }), h!, m!);
      setReminder(item.id, nid);
      showToast({ level: 'normal', title: t('routine.reminderOn'), body: t('routine.reminderOnBody', { time: item.time }) });
    } catch {
      showToast({ level: 'caution', title: t('routine.permissionTitle'), body: t('routine.reminderError') });
    }
  };

  const enableAll = async () => {
    for (const item of ROUTINE) if (!reminders[item.id]) await toggleReminder(item, true);
  };

  return (
    <Screen topInset={false}>
      <FadeInView style={{ gap: spacing.xs }}>
        <AppText variant="h1">{t('routine.title')}</AppText>
        <AppText color="textSecondary">{t('routine.subtitle')}</AppText>
      </FadeInView>

      <FadeInView index={1}>
        <Card tone="night" style={{ gap: spacing.md }}>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Ionicons name="time-outline" size={18} color={colors.primary} />
            <AppText variant="label" style={{ color: colors.onNightMuted }}>{t('routine.next')}</AppText>
          </View>
          <AppText variant="h3" style={{ color: colors.onNight }}>
            {nextItem ? `${nextItem.time} · ${t(`routine.items.${nextItem.id}.title` as never)}` : t('routine.allDone')}
          </AppText>
          <ProgressBar value={progress} color={colors.primary} label={t('routine.progress', { done: today.length, total: ROUTINE.length })} onDark />
          <PressableScale onPress={enableAll} accessibilityLabel={t('routine.enableAll')} style={[styles.row, { gap: spacing.xs, alignSelf: 'flex-start' }]}>
            <Ionicons name="notifications" size={16} color={colors.primary} />
            <AppText variant="label" style={{ color: colors.primary }}>{t('routine.enableAll')}</AppText>
          </PressableScale>
        </Card>
      </FadeInView>

      <View style={{ gap: spacing.sm }}>
        {ROUTINE.map((item, i) => {
          const isDone = today.includes(item.id);
          const isNext = nextItem?.id === item.id;
          const past = toMinutes(item.time) < nowMin && !isDone;
          const action = ACTION[item.id];
          return (
            <FadeInView key={item.id} index={2 + Math.min(i, 8)}>
              <Card
                style={[
                  styles.row,
                  { gap: spacing.md, padding: spacing.md, borderWidth: isNext ? 2 : 1, borderColor: isNext ? colors.primary : colors.border, opacity: isDone ? 0.65 : 1 },
                ]}
              >
                <PressableScale
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isDone }}
                  accessibilityLabel={t(`routine.items.${item.id}.title` as never)}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    toggleDone(item.id);
                  }}
                  style={[styles.check, { borderRadius: radius.md, backgroundColor: isDone ? colors.primary : colors.surfaceAlt, borderColor: isDone ? colors.primary : colors.border }]}
                >
                  <Ionicons name={isDone ? 'checkmark' : (item.icon as keyof typeof Ionicons.glyphMap)} size={22} color={isDone ? colors.onPrimary : colors.primaryText} />
                </PressableScale>
                <PressableScale style={styles.flex} disabled={!action} onPress={action} accessibilityLabel={t(`routine.items.${item.id}.title` as never)}>
                  <View style={[styles.row, { gap: spacing.sm }]}>
                    <AppText variant="label" color={past ? 'accentText' : 'textMuted'}>{item.time}</AppText>
                    <AppText variant="caption" color="textMuted">· {t(`routine.categories.${item.category}`)}</AppText>
                  </View>
                  <AppText variant="title" style={isDone ? styles.strike : undefined}>{t(`routine.items.${item.id}.title` as never)}</AppText>
                  <AppText variant="caption" color="textSecondary" numberOfLines={2}>{t(`routine.items.${item.id}.body` as never)}</AppText>
                  {action && <AppText variant="caption" color="primaryText">{t('routine.tapToOpen')}</AppText>}
                </PressableScale>
                <View style={styles.center}>
                  <Ionicons name={reminders[item.id] ? 'notifications' : 'notifications-off-outline'} size={16} color={reminders[item.id] ? colors.primaryText : colors.textMuted} />
                  <Switch
                    value={!!reminders[item.id]}
                    onValueChange={(on) => toggleReminder(item, on)}
                    trackColor={{ true: colors.primary, false: colors.progressTrack }}
                    thumbColor="#FFFFFF"
                    accessibilityLabel={t('routine.reminder')}
                  />
                </View>
              </Card>
            </FadeInView>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center' },
  check: { width: 48, height: 48, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  strike: { textDecorationLine: 'line-through' },
});
