import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppText, Button, Card, FadeInView, IconButton, PressableScale, Screen, VoiceNoteInput } from '@/presentation/components/ui';
import { useAuthStore } from '@/presentation/store/authStore';
import { checkInFlags, streakOf, SYMPTOMS, useCheckInStore, type CheckIn, type Symptom } from '@/presentation/store/checkInStore';
import { todayKey, useRoutineStore } from '@/presentation/store/routineStore';
import { resultsOf, TEST_IDS, useTestsStore } from '@/presentation/store/testsStore';
import { showToast } from '@/presentation/store/toastStore';

const MOOD_ICONS: (keyof typeof Ionicons.glyphMap)[] = ['sad-outline', 'sad-outline', 'remove-circle-outline', 'happy-outline', 'happy'];

/** Bienestar: check diario confidencial (se guarda solo en el dispositivo). */
export default function WellbeingScreen() {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const userId = useAuthStore((s) => s.session?.userId ?? '');
  const byDay = useCheckInStore((s) => s.entries[userId]);
  const save = useCheckInStore((s) => s.save);
  const today = byDay?.[todayKey()];
  const [editing, setEditing] = useState(false);
  const tests = useTestsStore((s) => s.results[userId]);
  const testsToday = TEST_IDS.filter((id) => resultsOf(tests, id).some((r) => r.day === todayKey())).length;

  const history = Object.values(byDay ?? {})
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, 7);

  return (
    <Screen topInset={false}>
      <FadeInView style={{ gap: spacing.xs }}>
        <AppText variant="h1">{t('wellbeing.title')}</AppText>
        <AppText color="textSecondary">{t('wellbeing.subtitle')}</AppText>
      </FadeInView>

      <FadeInView index={1}>
        <Card tone="night" style={[styles.row, { gap: spacing.lg }]}>
          <Stat value={String(streakOf(byDay))} label={t('wellbeing.streak')} />
          <Stat value={String(Object.keys(byDay ?? {}).length)} label={t('wellbeing.total')} />
          <Stat value={today ? '✓' : '—'} label={t('wellbeing.today')} />
        </Card>
      </FadeInView>

      <FadeInView index={1}>
        <Card onPress={() => router.push('/tests' as Href)} accessibilityLabel={t('tests.title')} style={[styles.row, { gap: spacing.md, borderWidth: 1, borderColor: colors.status.normal.ring }]}>
          <View style={[styles.doneIcon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="flash" size={24} color={colors.primaryText} />
          </View>
          <View style={styles.flex}>
            <AppText variant="title">{t('tests.title')}</AppText>
            <AppText variant="caption" color="textSecondary">{t('tests.cardBody', { done: testsToday, total: TEST_IDS.length })}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Card>
      </FadeInView>

      {today && !editing ? (
        <FadeInView index={2}>
          <Summary entry={today} onEdit={() => setEditing(true)} />
        </FadeInView>
      ) : (
        <FadeInView index={2}>
          <CheckInForm
            initial={today}
            onSubmit={(entry) => {
              const saved = save(userId, entry);
              // Marca también el ítem "check diario" de la rutina.
              const routine = useRoutineStore.getState();
              if (!(routine.done[todayKey()] ?? []).includes('dailyCheck')) routine.toggleDone('dailyCheck');
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              showToast({ level: 'normal', title: t('wellbeing.saved'), body: t('wellbeing.savedBody') });
              setEditing(false);
              return saved;
            }}
          />
        </FadeInView>
      )}

      {history.length > 0 && (
        <FadeInView index={3} style={{ gap: spacing.sm }}>
          <AppText variant="h3">{t('wellbeing.history')}</AppText>
          {history.map((h) => (
            <Card key={h.day} tone="alt" style={[styles.row, { gap: spacing.md, padding: spacing.md }]}>
              <Ionicons name={MOOD_ICONS[h.mood - 1]!} size={26} color={h.mood >= 4 ? colors.primaryText : h.mood <= 2 ? colors.accentText : colors.textSecondary} />
              <View style={styles.flex}>
                <AppText variant="title">{h.day}</AppText>
                <AppText variant="caption" color="textSecondary">
                  {t('wellbeing.historyLine', { sleep: h.sleepHours, energy: h.energy, stress: h.stress })}
                </AppText>
              </View>
              {checkInFlags(h).length > 0 && <Ionicons name="flag" size={18} color={colors.accentText} />}
            </Card>
          ))}
        </FadeInView>
      )}
      <AppText variant="caption" color="textMuted">{t('wellbeing.private')}</AppText>
    </Screen>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.flex}>
      <AppText variant="h2" style={{ color: colors.primary }}>{value}</AppText>
      <AppText variant="caption" style={{ color: colors.onNightMuted }}>{label}</AppText>
    </View>
  );
}

function Scale({ label, value, onChange, low, high }: { label: string; value: number; onChange: (v: number) => void; low: string; high: string }) {
  const { colors, spacing, radius } = useAppTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <AppText variant="title">{label}</AppText>
      <View style={[styles.row, { gap: spacing.sm }]}>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = n === value;
          return (
            <PressableScale
              key={n}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${label} ${n}`}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onChange(n);
              }}
              style={[styles.scaleBtn, { borderRadius: radius.md, backgroundColor: active ? colors.primary : colors.surfaceAlt, borderColor: active ? colors.primary : colors.border }]}
            >
              <AppText variant="title" style={{ color: active ? colors.onPrimary : colors.text }}>{n}</AppText>
            </PressableScale>
          );
        })}
      </View>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <AppText variant="caption" color="textMuted">{low}</AppText>
        <AppText variant="caption" color="textMuted">{high}</AppText>
      </View>
    </View>
  );
}

function CheckInForm({ initial, onSubmit }: { initial?: CheckIn; onSubmit: (e: Omit<CheckIn, 'day' | 'createdAt'>) => CheckIn }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const [mood, setMood] = useState(initial?.mood ?? 0);
  const [energy, setEnergy] = useState(initial?.energy ?? 0);
  const [stress, setStress] = useState(initial?.stress ?? 0);
  const [sleep, setSleep] = useState(initial?.sleepHours ?? 7);
  const [symptoms, setSymptoms] = useState<Symptom[]>(initial?.symptoms ?? []);
  const [note, setNote] = useState(initial?.note ?? '');
  const ready = mood > 0 && energy > 0 && stress > 0;

  const toggleSymptom = (s: Symptom) =>
    setSymptoms((cur) => (s === 'none' ? ['none'] : cur.includes(s) ? cur.filter((x) => x !== s) : [...cur.filter((x) => x !== 'none'), s]));

  return (
    <Card style={{ gap: spacing.xl }}>
      <View style={{ gap: 2 }}>
        <AppText variant="caption" color="textMuted">{t('wellbeing.formEyebrow')}</AppText>
        <AppText variant="h3">{t('wellbeing.formTitle')}</AppText>
      </View>

      <Scale label={t('wellbeing.mood')} value={mood} onChange={setMood} low={t('wellbeing.low')} high={t('wellbeing.high')} />
      <Scale label={t('wellbeing.energy')} value={energy} onChange={setEnergy} low={t('wellbeing.low')} high={t('wellbeing.high')} />
      <Scale label={t('wellbeing.stress')} value={stress} onChange={setStress} low={t('wellbeing.low')} high={t('wellbeing.high')} />

      <View style={{ gap: spacing.sm }}>
        <AppText variant="title">{t('wellbeing.sleep')}</AppText>
        <View style={[styles.row, { gap: spacing.lg }]}>
          <IconButton icon="remove" tone="filled" accessibilityLabel="-" onPress={() => setSleep((v) => Math.max(0, v - 0.5))} />
          <AppText variant="h2" style={{ minWidth: 90, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{t('wellbeing.hours', { count: sleep })}</AppText>
          <IconButton icon="add" tone="filled" accessibilityLabel="+" onPress={() => setSleep((v) => Math.min(14, v + 0.5))} />
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        <AppText variant="title">{t('wellbeing.symptoms')}</AppText>
        <View style={[styles.wrap, { gap: spacing.sm }]}>
          {SYMPTOMS.map((s) => {
            const on = symptoms.includes(s);
            return (
              <PressableScale
                key={s}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => toggleSymptom(s)}
                style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, backgroundColor: on ? colors.night : colors.surfaceAlt, borderColor: on ? colors.night : colors.border }}
              >
                <AppText variant="label" style={{ color: on ? colors.onNight : colors.text }}>{t(`wellbeing.symptomList.${s}`)}</AppText>
              </PressableScale>
            );
          })}
        </View>
      </View>

      <View style={{ gap: spacing.sm }}>
        <AppText variant="title">{t('wellbeing.note')}</AppText>
        <VoiceNoteInput value={note} onChangeText={setNote} placeholder={t('wellbeing.notePlaceholder')} />
      </View>

      <Button
        label={t('wellbeing.submit')}
        leftIcon="checkmark-done"
        size="lg"
        fullWidth
        disabled={!ready}
        onPress={() => onSubmit({ mood, energy, stress, sleepHours: sleep, symptoms, note: note.trim() || undefined })}
      />
      {!ready && <AppText variant="caption" color="textMuted" align="center">{t('wellbeing.completeScales')}</AppText>}
    </Card>
  );
}

function Summary({ entry, onEdit }: { entry: CheckIn; onEdit: () => void }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const flags = checkInFlags(entry);
  return (
    <Card style={{ gap: spacing.lg }}>
      <View style={[styles.row, { gap: spacing.md }]}>
        <View style={[styles.doneIcon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="checkmark-done" size={26} color={colors.primaryText} />
        </View>
        <View style={styles.flex}>
          <AppText variant="h3">{t('wellbeing.doneTitle')}</AppText>
          <AppText variant="caption" color="textMuted">{t('wellbeing.doneBody')}</AppText>
        </View>
      </View>
      <View style={[styles.row, { gap: spacing.sm }]}>
        {(['mood', 'energy', 'stress'] as const).map((k) => (
          <View key={k} style={[styles.flex, { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }]}>
            <AppText variant="h3">{entry[k]}/5</AppText>
            <AppText variant="caption" color="textMuted">{t(`wellbeing.${k}`)}</AppText>
          </View>
        ))}
        <View style={[styles.flex, { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }]}>
          <AppText variant="h3">{entry.sleepHours}h</AppText>
          <AppText variant="caption" color="textMuted">{t('wellbeing.sleepShort')}</AppText>
        </View>
      </View>
      {flags.length > 0 ? (
        <View style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.status.caution.background }}>
          {flags.map((f) => (
            <View key={f} style={[styles.row, { gap: spacing.sm, alignItems: 'flex-start' }]}>
              <Ionicons name="flag-outline" size={16} color={colors.status.caution.text} style={{ marginTop: 3 }} />
              <AppText variant="bodySmall" style={[styles.flex, { color: colors.status.caution.text }]}>{t(`wellbeing.flags.${f}`)}</AppText>
            </View>
          ))}
          {flags.includes('vision') && (
            <Button label={t('wellbeing.goMonitor')} variant="secondary" size="sm" onPress={() => router.navigate('/body')} />
          )}
        </View>
      ) : (
        <AppText color="primaryText">{t('wellbeing.allGood')}</AppText>
      )}
      <Button label={t('wellbeing.edit')} variant="outline" leftIcon="create-outline" onPress={onEdit} />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  scaleBtn: { flex: 1, height: 48, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  doneIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
});
