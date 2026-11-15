import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { screeningSchedule } from '@/domain/wellbeing/screening';
import { sustainedChanges, VAS_DIMENSIONS, type VasDimension } from '@/domain/wellbeing/trends';
import { AppText, Button, Card, FadeInView, IconButton, PressableScale, Screen, VasSlider, VoiceNoteInput } from '@/presentation/components/ui';
import { useMissionStatus } from '@/presentation/hooks/useMissionStatus';
import { useAuthStore } from '@/presentation/store/authStore';
import { streakOf, SYMPTOMS, useCheckInStore, wristbandSleep, type CheckIn, type Symptom } from '@/presentation/store/checkInStore';
import { todayKey, useRoutineStore } from '@/presentation/store/routineStore';
import { resultsOf, TEST_IDS, useTestsStore } from '@/presentation/store/testsStore';
import { showToast } from '@/presentation/store/toastStore';
import { fitnessToday, useWellbeingStore } from '@/presentation/store/wellbeingStore';

/**
 * BIENESTAR — confidencial por diseño (NASA BHP Standard Measures: VAS, Cognition/PVT-B, conferencias cada 2 semanas).
 * El detalle solo lo ven el astronauta y salud conductual. La racha premia completar, nunca el resultado.
 */
export default function WellbeingScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const userId = useAuthStore((s) => s.session?.userId ?? '');
  const byDay = useCheckInStore((s) => s.entries[userId]);
  const save = useCheckInStore((s) => s.save);
  const seedSynthetic = useCheckInStore((s) => s.seedSynthetic);
  const today = byDay?.[todayKey()];
  const [editing, setEditing] = useState(false);
  const tests = useTestsStore((s) => s.results[userId]);
  const testsToday = TEST_IDS.filter((id) => resultsOf(tests, id).some((r) => r.day === todayKey())).length;
  const fitness = useWellbeingStore((s) => s.fitness[userId]);
  const screenings = useWellbeingStore((s) => s.screenings[userId]);
  const shared = useWellbeingStore((s) => !!s.shareWithCrew[userId]);
  const fitToday = fitnessToday(fitness);
  const mission = useMissionStatus();
  const missionDay = mission?.missionDay ?? 1;
  const schedule = screeningSchedule(missionDay, screenings?.[screenings.length - 1]?.missionDay);

  const entries = useMemo(() => Object.values(byDay ?? {}), [byDay]);
  const changes = useMemo(() => sustainedChanges(entries), [entries]);
  const history = [...entries].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 7);

  return (
    <Screen topInset={false}>
      <FadeInView style={{ gap: spacing.xs }}>
        <AppText variant="h1">{t('wellbeing.title')}</AppText>
        <AppText color="textSecondary">{t('wellbeing.subtitle')}</AppText>
      </FadeInView>

      <FadeInView index={1}>
        <Card tone="night" style={[styles.row, { gap: spacing.lg }]}>
          <Stat value={String(streakOf(byDay))} label={t('wellbeing.streak')} />
          <Stat value={String(entries.length)} label={t('wellbeing.total')} />
          <Stat value={today ? '✓' : '—'} label={t('wellbeing.today')} />
        </Card>
      </FadeInView>

      {changes.length > 0 && (
        <FadeInView index={1}>
          <Card style={{ gap: spacing.sm, backgroundColor: colors.status.caution.background, borderColor: colors.status.caution.ring }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Ionicons name="trending-down" size={20} color={colors.status.caution.text} />
              <AppText variant="title" style={[styles.flex, { color: colors.status.caution.text }]}>{t('wellbeingPlus.sustainedTitle')}</AppText>
            </View>
            {changes.map((c) => (
              <AppText key={c.dimension} variant="bodySmall" style={{ color: colors.status.caution.text }}>
                · {t(`wellbeingPlus.sustained.${c.dimension}`)}
              </AppText>
            ))}
            <AppText variant="caption" color="textSecondary">{t('wellbeingPlus.sustainedNote')}</AppText>
            <Button label={t('wellbeingPlus.talk.cta')} leftIcon="chatbubbles-outline" variant="secondary" onPress={() => router.push('/wellbeing/talk')} />
          </Card>
        </FadeInView>
      )}

      {today && !editing ? (
        <FadeInView index={2}>
          <Summary entry={today} onEdit={() => setEditing(true)} />
        </FadeInView>
      ) : (
        <FadeInView index={2}>
          <CheckInForm
            initial={today}
            onSubmit={(entry) => {
              save(userId, entry);
              const routine = useRoutineStore.getState();
              if (!(routine.done[todayKey()] ?? []).includes('dailyCheck')) routine.toggleDone('dailyCheck');
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              showToast({ level: 'normal', title: t('wellbeing.saved'), body: t('wellbeing.savedBody') });
              setEditing(false);
            }}
          />
        </FadeInView>
      )}

      {/* Prueba de reacción (aptitud para tareas críticas) */}
      <FadeInView index={3}>
        <Card onPress={() => router.push('/tests/reaction')} accessibilityLabel={t('wellbeingPlus.fit.title')} style={[styles.row, { gap: spacing.md }]}>
          <View style={[styles.icon, { backgroundColor: fitToday?.fit === 'yes' ? colors.status.normal.background : colors.surfaceAlt }]}>
            <Ionicons name={fitToday?.fit === 'yes' ? 'shield-checkmark' : 'speedometer-outline'} size={24} color={fitToday?.fit === 'yes' ? colors.status.normal.text : colors.primaryText} />
          </View>
          <View style={styles.flex}>
            <AppText variant="title">{t('wellbeingPlus.fit.title')}</AppText>
            <AppText variant="caption" color="textSecondary">
              {fitToday ? t(`wellbeingPlus.pvt.verdict.${fitToday.fit}`) : t('wellbeingPlus.fit.pending')}
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Card>
      </FadeInView>

      {/* PHQ-2 + GAD-2 quincenal */}
      <FadeInView index={4}>
        <Card onPress={() => router.push('/wellbeing/screening')} accessibilityLabel={t('wellbeingPlus.screening.title')} style={[styles.row, { gap: spacing.md, borderWidth: schedule.open ? 2 : 1, borderColor: schedule.open ? colors.primary : colors.border }]}>
          <View style={[styles.icon, { backgroundColor: colors.surfaceAlt }]}>
            <Ionicons name="clipboard-outline" size={24} color={colors.primaryText} />
          </View>
          <View style={styles.flex}>
            <AppText variant="title">{t('wellbeingPlus.screening.title')}</AppText>
            <AppText variant="caption" color="textSecondary">
              {schedule.doneThisCycle
                ? t('wellbeingPlus.screening.done', { day: schedule.conference })
                : schedule.open
                  ? t('wellbeingPlus.screening.open', { day: schedule.conference })
                  : t('wellbeingPlus.screening.next', { count: schedule.daysUntilOpen, day: schedule.conference })}
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Card>
      </FadeInView>

      {/* Quiero hablar con alguien */}
      <FadeInView index={5}>
        <Card onPress={() => router.push('/wellbeing/talk')} accessibilityLabel={t('wellbeingPlus.talk.title')} style={[styles.row, { gap: spacing.md }]}>
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="chatbubbles-outline" size={24} color={colors.primaryText} />
          </View>
          <View style={styles.flex}>
            <AppText variant="title">{t('wellbeingPlus.talk.title')}</AppText>
            <AppText variant="caption" color="textSecondary">{t('wellbeingPlus.talk.cardBody')}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Card>
      </FadeInView>

      <FadeInView index={6}>
        <Card onPress={() => router.push('/tests' as Href)} accessibilityLabel={t('tests.title')} style={[styles.row, { gap: spacing.md }]}>
          <View style={[styles.icon, { backgroundColor: colors.surfaceAlt }]}>
            <Ionicons name="flash" size={24} color={colors.primaryText} />
          </View>
          <View style={styles.flex}>
            <AppText variant="title">{t('tests.title')}</AppText>
            <AppText variant="caption" color="textSecondary">{t('tests.cardBody', { done: testsToday, total: TEST_IDS.length })}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Card>
      </FadeInView>

      {/* Privacidad */}
      <FadeInView index={7}>
        <Card tone="alt" onPress={() => router.push('/wellbeing/privacy')} accessibilityLabel={t('wellbeingPlus.privacy.title')} style={[styles.row, { gap: spacing.md }]}>
          <Ionicons name="lock-closed" size={22} color={colors.primaryText} />
          <View style={styles.flex}>
            <AppText variant="title">{t('wellbeingPlus.privacy.title')}</AppText>
            <AppText variant="caption" color="textSecondary">{shared ? t('wellbeingPlus.privacy.sharedOn') : t('wellbeingPlus.privacy.sharedOff')}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Card>
      </FadeInView>

      <FadeInView index={8} style={{ gap: spacing.sm }}>
        <AppText variant="h3">{t('wellbeing.history')}</AppText>
        {history.map((h) => (
          <Card key={h.day} tone="alt" style={{ gap: spacing.sm, padding: spacing.md }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <AppText variant="title" style={styles.flex}>{h.day}</AppText>
              {h.synthetic && <AppText variant="caption" color="textMuted">{t('common.syntheticData')}</AppText>}
              <AppText variant="caption" color="textSecondary">{t('wellbeingPlus.sleepLine', { hours: h.sleepHours })}</AppText>
            </View>
            <View style={[styles.row, { gap: spacing.xs }]}>
              {VAS_DIMENSIONS.map((d) => (
                <MiniBar key={d} label={t(`wellbeingPlus.vas.${d}.short`)} value={h.vas[d]} />
              ))}
            </View>
          </Card>
        ))}
        {entries.length < 5 && (
          <View style={[styles.row, { gap: spacing.sm }]}>
            <View style={styles.flex}>
              <Button label={t('wellbeingPlus.seedStable')} variant="ghost" size="sm" leftIcon="flask-outline" fullWidth onPress={() => seedSynthetic(userId, false)} />
            </View>
            <View style={styles.flex}>
              <Button label={t('wellbeingPlus.seedWorsening')} variant="ghost" size="sm" leftIcon="flask-outline" fullWidth onPress={() => seedSynthetic(userId, true)} />
            </View>
          </View>
        )}
      </FadeInView>
      <View style={{ padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }}>
        <AppText variant="caption" color="textMuted">{t('wellbeingPlus.limits')}</AppText>
      </View>
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

/** Barra sin números para el historial (misma idea que la VAS). */
function MiniBar({ label, value }: { label: string; value?: number }) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={[styles.flex, { gap: 2 }]}>
      <View style={{ height: 6, borderRadius: radius.pill, backgroundColor: colors.progressTrack, overflow: 'hidden' }}>
        <View style={{ width: `${value ?? 0}%`, height: 6, backgroundColor: colors.tertiary }} />
      </View>
      <AppText variant="caption" color="textMuted" numberOfLines={1}>{label}</AppText>
    </View>
  );
}

function CheckInForm({ initial, onSubmit }: { initial?: CheckIn; onSubmit: (e: Omit<CheckIn, 'day' | 'createdAt'>) => void }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const [vas, setVas] = useState<Partial<Record<VasDimension, number>>>(initial?.vas ?? {});
  const band = wristbandSleep();
  const [sleep, setSleep] = useState(initial?.sleepHours ?? band);
  const [symptoms, setSymptoms] = useState<Symptom[]>(initial?.symptoms ?? []);
  const [note, setNote] = useState(initial?.note ?? '');
  const [more, setMore] = useState(false);
  const ready = VAS_DIMENSIONS.every((d) => vas[d] !== undefined);

  const toggleSymptom = (s: Symptom) =>
    setSymptoms((cur) => (s === 'none' ? ['none'] : cur.includes(s) ? cur.filter((x) => x !== s) : [...cur.filter((x) => x !== 'none'), s]));

  return (
    <Card style={{ gap: spacing.xl }}>
      <View style={{ gap: 2 }}>
        <AppText variant="caption" color="textMuted">{t('wellbeingPlus.formEyebrow')}</AppText>
        <AppText variant="h3">{t('wellbeing.formTitle')}</AppText>
      </View>

      {VAS_DIMENSIONS.map((d) => (
        <VasSlider key={d} label={t(`wellbeingPlus.vas.${d}.label`)} low={t(`wellbeingPlus.vas.${d}.low`)} high={t(`wellbeingPlus.vas.${d}.high`)} value={vas[d]} onChange={(v) => setVas((cur) => ({ ...cur, [d]: v }))} />
      ))}

      <View style={{ gap: spacing.sm }}>
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Ionicons name="watch-outline" size={18} color={colors.primaryText} />
          <AppText variant="title" style={styles.flex}>{t('wellbeing.sleep')}</AppText>
          <AppText variant="caption" color="textMuted">{sleep === band ? t('wellbeingPlus.fromWristband') : t('wellbeingPlus.corrected')}</AppText>
        </View>
        <View style={[styles.row, { gap: spacing.lg }]}>
          <IconButton icon="remove" tone="filled" accessibilityLabel="-" onPress={() => setSleep((v) => Math.max(0, v - 0.5))} />
          <AppText variant="h2" style={{ minWidth: 90, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{t('wellbeing.hours', { count: sleep })}</AppText>
          <IconButton icon="add" tone="filled" accessibilityLabel="+" onPress={() => setSleep((v) => Math.min(14, v + 0.5))} />
        </View>
      </View>

      {more ? (
        <>
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
        </>
      ) : (
        <Button label={t('wellbeingPlus.addMore')} variant="ghost" size="sm" leftIcon="add" onPress={() => setMore(true)} />
      )}

      <Button
        label={t('wellbeing.submit')}
        leftIcon="checkmark-done"
        size="lg"
        fullWidth
        disabled={!ready}
        onPress={() => onSubmit({ vas, sleepHours: sleep, sleepSource: sleep === band ? 'wristband' : 'manual', symptoms, note: note.trim() || undefined })}
      />
      {!ready && <AppText variant="caption" color="textMuted" align="center">{t('wellbeingPlus.completeScales')}</AppText>}
    </Card>
  );
}

function Summary({ entry, onEdit }: { entry: CheckIn; onEdit: () => void }) {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();
  return (
    <Card style={{ gap: spacing.lg }}>
      <View style={[styles.row, { gap: spacing.md }]}>
        <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="checkmark-done" size={26} color={colors.primaryText} />
        </View>
        <View style={styles.flex}>
          <AppText variant="h3">{t('wellbeing.doneTitle')}</AppText>
          <AppText variant="caption" color="textMuted">{t('wellbeingPlus.doneBody')}</AppText>
        </View>
      </View>
      <View style={[styles.row, { gap: spacing.sm }]}>
        {VAS_DIMENSIONS.map((d) => (
          <MiniBar key={d} label={t(`wellbeingPlus.vas.${d}.short`)} value={entry.vas[d]} />
        ))}
      </View>
      {entry.symptoms.includes('blurredVision') && (
        <Button label={t('wellbeing.goMonitor')} variant="secondary" size="sm" onPress={() => router.navigate('/body')} />
      )}
      <Button label={t('wellbeing.edit')} variant="outline" leftIcon="create-outline" onPress={onEdit} />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  icon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
});
