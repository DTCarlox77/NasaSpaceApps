import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { apiEnabled } from '@/core/config/env';
import { useAppTheme } from '@/core/theme';
import { container } from '@/di/container';
import {
  AppText,
  Button,
  Card,
  FadeInView,
  IconButton,
  PressableScale,
  Screen,
  Slider,
  ToggleRow,
  VoiceNoteInput,
} from '@/presentation/components/ui';
import { useAuthStore } from '@/presentation/store/authStore';
import { streakOf, SYMPTOMS, useCheckInStore, type CheckIn, type Symptom } from '@/presentation/store/checkInStore';
import { todayKey, useRoutineStore } from '@/presentation/store/routineStore';
import { resultsOf, TEST_IDS, useTestsStore } from '@/presentation/store/testsStore';
import { showToast } from '@/presentation/store/toastStore';
import { refreshPendingCount } from '@/presentation/sync/syncEngine';

type FormValues = Pick<CheckIn, 'mood' | 'fatigue' | 'stress' | 'crewConflict' | 'sleepHours' | 'symptoms' | 'note'>;

/**
 * Bienestar (confidencial, guía §11). Al astronauta NUNCA se le muestra un puntaje, color ni semáforo de
 * bienestar: solo el mensaje neutro del servidor, la racha de check-ins y "Quiero hablar con alguien".
 */
export default function WellbeingScreen() {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const userId = useAuthStore((s) => s.session?.userId ?? '');
  const byDay = useCheckInStore((s) => s.entries[userId]);
  const save = useCheckInStore((s) => s.save);
  const today = byDay?.[todayKey()];
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const tests = useTestsStore((s) => s.results[userId]);
  const testsToday = TEST_IDS.filter((id) => resultsOf(tests, id).some((r) => r.day === todayKey())).length;

  const entries = Object.values(byDay ?? {}).sort((a, b) => b.day.localeCompare(a.day));
  const history = entries.slice(0, 7);
  // Con API, la racha es la del servidor (cuenta check-ins hechos, nunca el resultado).
  const serverStreak = entries.find((e) => e.streak)?.streak ?? null;

  const submit = async (values: FormValues) => {
    setSending(true);
    const measuredAt = new Date().toISOString();
    try {
      const out = await container.submitCheckIn.execute({
        mood: values.mood ?? 50,
        fatigue: values.fatigue ?? 50,
        stress: values.stress ?? 50,
        crewConflict: values.crewConflict ?? 50,
        sleepHours: values.sleepHours ?? null,
        privateNote: values.note ?? null,
        measuredAt,
      });
      // Los síntomas son una lectura FÍSICA (SYMPTOM, POST /readings): no son parte del check-in confidencial.
      const symptoms = values.symptoms.filter((s) => s !== 'none');
      if (symptoms.length) await container.submitReading.execute({ indicatorId: 'symptoms', symptoms, source: 'manual', takenAt: measuredAt }).catch(() => null);

      save(userId, {
        ...values,
        clientUuid: out.clientUuid,
        state: out.status,
        message: out.status === 'sent' ? out.message : undefined,
        streak: out.status === 'sent' ? out.streak : null,
        screeningDue: out.status === 'sent' ? out.screeningDue : false,
        corrected: out.status === 'sent' ? !!out.supersedesId : !!today,
      });
      if (out.status === 'queued') void refreshPendingCount();
      // Marca también el ítem "check diario" de la rutina.
      const routine = useRoutineStore.getState();
      if (!(routine.done[todayKey()] ?? []).includes('dailyCheck')) routine.toggleDone('dailyCheck');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast({ level: 'normal', title: t('wellbeing.saved'), body: t(out.status === 'queued' ? 'wellbeing.queued' : 'wellbeing.savedBody') });
      setEditing(false);
    } catch {
      showToast({ level: 'caution', title: t('wellbeing.errorTitle'), body: t('wellbeing.errorBody') });
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen topInset={false}>
      <FadeInView style={{ gap: spacing.xs }}>
        <AppText variant="h1">{t('wellbeing.title')}</AppText>
        <AppText color="textSecondary">{t('wellbeing.subtitle')}</AppText>
      </FadeInView>

      <FadeInView index={1}>
        <Card tone="night" style={[styles.row, { gap: spacing.lg }]}>
          <Stat value={String(serverStreak?.streakDays ?? streakOf(byDay))} label={t('wellbeing.streak')} />
          {serverStreak ? (
            <Stat value={`${serverStreak.checkinsThisWeek}/${serverStreak.checkinsGoalWeek}`} label={t('wellbeing.week')} />
          ) : (
            <Stat value={String(entries.length)} label={t('wellbeing.total')} />
          )}
          <Stat value={today ? '✓' : '—'} label={t('wellbeing.today')} />
        </Card>
      </FadeInView>

      {/* Siempre visible (offer_support = true). */}
      <FadeInView index={1}>
        <Button label={t('support.cta')} variant="secondary" leftIcon="chatbubbles-outline" fullWidth onPress={() => router.push('/support' as Href)} />
      </FadeInView>

      <FadeInView index={1}>
        <Card onPress={() => router.push('/tests' as Href)} accessibilityLabel={t('tests.title')} style={[styles.row, { gap: spacing.md, borderWidth: 1, borderColor: colors.border }]}>
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

      {apiEnabled() && today?.screeningDue && (
        <FadeInView index={2}>
          <Card onPress={() => router.push('/screening' as Href)} accessibilityLabel={t('screening.cardTitle')} style={[styles.row, { gap: spacing.md, borderWidth: 1, borderColor: colors.border }]}>
            <View style={[styles.doneIcon, { backgroundColor: colors.surfaceAlt }]}>
              <Ionicons name="clipboard-outline" size={24} color={colors.textSecondary} />
            </View>
            <View style={styles.flex}>
              <AppText variant="title">{t('screening.cardTitle')}</AppText>
              <AppText variant="caption" color="textSecondary">{t('screening.cardBody')}</AppText>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </Card>
        </FadeInView>
      )}

      {today && !editing ? (
        <FadeInView index={2}>
          <Summary entry={today} onEdit={() => setEditing(true)} />
        </FadeInView>
      ) : (
        <FadeInView index={2}>
          <CheckInForm initial={today} sending={sending} onSubmit={submit} />
        </FadeInView>
      )}

      {history.length > 0 && (
        <FadeInView index={3} style={{ gap: spacing.sm }}>
          <AppText variant="h3">{t('wellbeing.history')}</AppText>
          {history.map((h) => (
            <Card key={h.day} tone="alt" style={[styles.row, { gap: spacing.md, padding: spacing.md }]}>
              <Ionicons name="checkmark-done" size={22} color={colors.textSecondary} />
              <View style={styles.flex}>
                <AppText variant="title">{h.day}</AppText>
                <AppText variant="caption" color="textSecondary">
                  {[t('wellbeing.historyDone'), h.note ? t('wellbeing.historyNote') : null, h.state === 'queued' ? t('wellbeing.pendingSync') : null]
                    .filter(Boolean)
                    .join(' · ')}
                </AppText>
              </View>
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

function CheckInForm({ initial, sending, onSubmit }: { initial?: CheckIn; sending: boolean; onSubmit: (v: FormValues) => void }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const [mood, setMood] = useState<number | null>(initial?.mood ?? null);
  const [fatigue, setFatigue] = useState<number | null>(initial?.fatigue ?? null);
  const [stress, setStress] = useState<number | null>(initial?.stress ?? null);
  const [crewConflict, setCrewConflict] = useState<number | null>(initial?.crewConflict ?? null);
  const [withSleep, setWithSleep] = useState(initial?.sleepHours != null);
  const [sleep, setSleep] = useState(initial?.sleepHours ?? 7);
  const [symptoms, setSymptoms] = useState<Symptom[]>(initial?.symptoms ?? []);
  const [note, setNote] = useState(initial?.note ?? '');
  const ready = mood !== null && fatigue !== null && stress !== null && crewConflict !== null;

  const toggleSymptom = (s: Symptom) =>
    setSymptoms((cur) => (s === 'none' ? ['none'] : cur.includes(s) ? cur.filter((x) => x !== s) : [...cur.filter((x) => x !== 'none'), s]));

  return (
    <Card style={{ gap: spacing.xl }}>
      <View style={{ gap: 2 }}>
        <AppText variant="caption" color="textMuted">{t('wellbeing.formEyebrow')}</AppText>
        <AppText variant="h3">{initial ? t('wellbeing.correctTitle') : t('wellbeing.formTitle')}</AppText>
        {initial && <AppText variant="caption" color="textMuted">{t('wellbeing.correctBody')}</AppText>}
      </View>

      <Slider label={t('wellbeing.mood')} value={mood} onChange={setMood} low={t('wellbeing.sliders.moodLow')} high={t('wellbeing.sliders.moodHigh')} />
      <Slider label={t('wellbeing.fatigue')} value={fatigue} onChange={setFatigue} low={t('wellbeing.sliders.fatigueLow')} high={t('wellbeing.sliders.fatigueHigh')} />
      <Slider label={t('wellbeing.stress')} value={stress} onChange={setStress} low={t('wellbeing.sliders.stressLow')} high={t('wellbeing.sliders.stressHigh')} />
      <Slider label={t('wellbeing.crewConflict')} value={crewConflict} onChange={setCrewConflict} low={t('wellbeing.sliders.conflictLow')} high={t('wellbeing.sliders.conflictHigh')} />

      <View style={{ gap: spacing.sm }}>
        <ToggleRow icon="moon-outline" title={t('wellbeing.sleepOptional')} value={withSleep} onValueChange={setWithSleep} />
        {withSleep && (
          <View style={[styles.row, { gap: spacing.lg }]}>
            <IconButton icon="remove" tone="filled" accessibilityLabel="-" onPress={() => setSleep((v) => Math.max(0, v - 0.5))} />
            <AppText variant="h2" style={{ minWidth: 90, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{t('wellbeing.hours', { count: sleep })}</AppText>
            <IconButton icon="add" tone="filled" accessibilityLabel="+" onPress={() => setSleep((v) => Math.min(14, v + 0.5))} />
          </View>
        )}
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
        <AppText variant="caption" color="textMuted">{t(apiEnabled() ? 'wellbeing.symptomsShared' : 'wellbeing.symptomsLocal')}</AppText>
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
        loading={sending}
        disabled={!ready || sending}
        onPress={() =>
          onSubmit({
            mood: mood ?? undefined,
            fatigue: fatigue ?? undefined,
            stress: stress ?? undefined,
            crewConflict: crewConflict ?? undefined,
            sleepHours: withSleep ? sleep : null,
            symptoms,
            note: note.trim() || undefined,
          })
        }
      />
      {!ready && <AppText variant="caption" color="textMuted" align="center">{t('wellbeing.completeScales')}</AppText>}
    </Card>
  );
}

/** Resumen del día: SOLO el mensaje neutro del servidor y la racha. Sin valores, colores ni señales. */
function Summary({ entry, onEdit }: { entry: CheckIn; onEdit: () => void }) {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const message = entry.message ?? (entry.state === 'queued' ? t('wellbeing.queued') : t('wellbeing.localMessage'));
  return (
    <Card style={{ gap: spacing.lg }}>
      <View style={[styles.row, { gap: spacing.md }]}>
        <View style={[styles.doneIcon, { backgroundColor: colors.surfaceAlt }]}>
          <Ionicons name="checkmark-done" size={26} color={colors.textSecondary} />
        </View>
        <View style={styles.flex}>
          <AppText variant="h3">{t('wellbeing.doneTitle')}</AppText>
          {entry.corrected && <AppText variant="caption" color="textMuted">{t('wellbeing.corrected')}</AppText>}
        </View>
      </View>
      {/* Mensaje del servidor tal cual (neutro). */}
      <AppText>{message}</AppText>
      {entry.streak && (
        <AppText variant="bodySmall" color="textSecondary">
          {t('wellbeing.streakLine', { days: entry.streak.streakDays, week: entry.streak.checkinsThisWeek, goal: entry.streak.checkinsGoalWeek })}
        </AppText>
      )}
      <Button label={t('wellbeing.edit')} variant="outline" leftIcon="create-outline" onPress={onEdit} />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  doneIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
});
