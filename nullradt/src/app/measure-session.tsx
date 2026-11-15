import { useCallback, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import type { IndicatorId } from '@/domain/entities/HealthIndicator';
import { nextDueAt } from '@/domain/usecases/IndicatorHistory';
import { isMeasurable } from '@/domain/usecases/SimulateMeasurement';
import { AppText, Button, Card, FadeInView, IconButton, PressableScale, ProgressBar, Screen, SegmentedControl, StatusBadge } from '@/presentation/components/ui';
import { formatValue } from '@/presentation/features/health/healthUi';
import { useHealthOverview } from '@/presentation/hooks/useHealthOverview';
import { useNow } from '@/presentation/hooks/useNow';
import { useAuthStore } from '@/presentation/store/authStore';
import { activeSession, MEASURE_ORDER, openMeasurement, pendingOf, useMeasureSessionStore, type SessionMode } from '@/presentation/store/measureSessionStore';
import { todayKey } from '@/presentation/store/routineStore';
import { showDialog } from '@/presentation/store/dialogStore';

/**
 * Registrar medición: primero el menú de mediciones PENDIENTES (presión arterial, oxígeno, …).
 * Se hacen paso a paso o en el orden que se elija, pero la sesión solo termina cuando están todas.
 */
export default function MeasureSessionScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const userId = useAuthStore((s) => s.session?.userId ?? '');
  const { overview, localReadings } = useHealthOverview();
  const stored = useMeasureSessionStore((s) => s.session);
  const { start, setMode, clear } = useMeasureSessionStore();
  const session = activeSession(stored, userId);
  const [mode, setModeLocal] = useState<SessionMode>('guided');
  const now = useNow(60_000);

  // Pendientes: signos vitales aún no medidos hoy + cualquier otro indicador con la medición vencida.
  const pending = useMemo<IndicatorId[]>(() => {
    if (!overview) return [];
    const today = todayKey();
    const measuredToday = new Set(localReadings.filter((r) => todayKey(new Date(r.reading.takenAt)) === today).map((r) => r.indicatorId));
    return MEASURE_ORDER.filter((id) => {
      const ind = overview.indicators.find((i) => i.id === id);
      if (!ind || measuredToday.has(id)) return false;
      if (isMeasurable(id)) return true;
      const due = nextDueAt(ind);
      return due !== null && due < now;
    });
  }, [overview, localReadings, now]);

  const remaining = session ? pendingOf(session) : [];
  const complete = !!session && remaining.length === 0;
  const next = remaining[0];

  const left = remaining.length;
  const incomplete = !!session && left > 0;
  const leave = useCallback(() => {
    if (incomplete) {
      showDialog({
        title: t('measureSession.leaveTitle'),
        body: t('measureSession.leaveBody', { count: left }),
        icon: 'pulse-outline',
        tone: 'caution',
        actions: [
          { label: t('measureSession.keepGoing'), variant: 'primary', icon: 'play-outline' },
          { label: t('measureSession.leaveAnyway'), variant: 'ghost', onPress: () => (router.canGoBack() ? router.back() : router.replace('/')) },
        ],
      });
      return true;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/');
    return true;
  }, [incomplete, left, t]);

  // Botón "atrás" de Android: avisa si quedan mediciones.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', leave);
      return () => sub.remove();
    }, [leave]),
  );

  const name = (id: IndicatorId) => t(`indicators.${id}.name`);

  return (
    <Screen>
      <FadeInView style={[styles.row, { gap: spacing.md }]}>
        <IconButton icon="arrow-back" tone="filled" accessibilityLabel={t('common.back')} onPress={leave} />
        <View style={styles.flex}>
          <AppText variant="h2">{t('measureSession.title')}</AppText>
          <AppText variant="caption" color="textMuted">{t('measureSession.subtitle')}</AppText>
        </View>
      </FadeInView>

      {!session ? (
        pending.length === 0 ? (
          <Card style={[styles.center, { gap: spacing.md, paddingVertical: spacing.xxl }]}>
            <Ionicons name="checkmark-done-circle" size={56} color={colors.primaryText} />
            <AppText variant="h3" align="center">{t('measureSession.nothingTitle')}</AppText>
            <AppText color="textSecondary" align="center">{t('measureSession.nothingBody')}</AppText>
            <Button label={t('measureSession.registerOther')} variant="outline" leftIcon="camera-outline" onPress={() => router.replace('/register')} />
          </Card>
        ) : (
          <>
            <FadeInView index={1}>
              <Card style={{ gap: spacing.md }}>
                <AppText variant="h3">{t('measureSession.pendingTitle', { count: pending.length })}</AppText>
                {pending.map((id, i) => (
                  <View key={id} style={[styles.row, { gap: spacing.md }]}>
                    <View style={[styles.num, { backgroundColor: colors.primarySoft }]}>
                      <AppText variant="label" color="primaryText">{i + 1}</AppText>
                    </View>
                    <AppText variant="title" style={styles.flex}>{name(id)}</AppText>
                    <Ionicons name={isMeasurable(id) ? 'bluetooth' : 'camera-outline'} size={16} color={colors.textMuted} />
                  </View>
                ))}
                <AppText variant="caption" color="textMuted">{t('measureSession.mustComplete')}</AppText>
              </Card>
            </FadeInView>
            <FadeInView index={2} style={{ gap: spacing.sm }}>
              <AppText variant="label" color="textSecondary">{t('measureSession.howTitle')}</AppText>
              <SegmentedControl<SessionMode>
                value={mode}
                onChange={setModeLocal}
                options={[
                  { value: 'guided', label: t('measureSession.guided'), icon: 'footsteps-outline' },
                  { value: 'free', label: t('measureSession.free'), icon: 'apps-outline' },
                ]}
              />
              <AppText variant="caption" color="textMuted">{mode === 'guided' ? t('measureSession.guidedHint') : t('measureSession.freeHint')}</AppText>
            </FadeInView>
            <Button
              label={t('measureSession.start')}
              leftIcon="play"
              size="lg"
              fullWidth
              onPress={() => {
                start(userId, pending, mode);
                if (mode === 'guided') openMeasurement(pending[0]!);
              }}
            />
          </>
        )
      ) : (
        <>
          <FadeInView index={1}>
            <Card tone="night" style={{ gap: spacing.md }}>
              <AppText variant="h3" style={{ color: colors.onNight }}>
                {complete ? t('measureSession.completeTitle') : t('measureSession.progress', { done: session.done.length, total: session.items.length })}
              </AppText>
              <ProgressBar value={session.done.length / session.items.length} color={colors.primary} onDark />
              {!complete && session.mode === 'guided' && next && (
                <AppText style={{ color: colors.onNightMuted }}>{t('measureSession.nextIs', { name: name(next) })}</AppText>
              )}
              {complete && <AppText style={{ color: colors.onNightMuted }}>{t('measureSession.completeBody')}</AppText>}
            </Card>
          </FadeInView>

          {!complete && (
            <SegmentedControl<SessionMode>
              value={session.mode}
              onChange={setMode}
              options={[
                { value: 'guided', label: t('measureSession.guided'), icon: 'footsteps-outline' },
                { value: 'free', label: t('measureSession.free'), icon: 'apps-outline' },
              ]}
            />
          )}

          <View style={{ gap: spacing.sm }}>
            {session.items.map((id, i) => {
              const done = session.done.includes(id);
              const ind = overview?.indicators.find((x) => x.id === id);
              // Paso a paso: solo se puede abrir la siguiente; a elección: cualquiera pendiente.
              const locked = !done && session.mode === 'guided' && id !== next;
              return (
                <FadeInView key={id} index={2 + i}>
                  <PressableScale
                    disabled={done || locked}
                    onPress={() => openMeasurement(id)}
                    accessibilityLabel={name(id)}
                    style={[
                      styles.row,
                      {
                        gap: spacing.md,
                        padding: spacing.md,
                        borderRadius: radius.button,
                        backgroundColor: done ? colors.surfaceTinted : colors.surface,
                        borderWidth: id === next && !complete ? 2 : 1,
                        borderColor: id === next && !complete ? colors.primary : colors.border,
                        opacity: locked ? 0.55 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.num, { backgroundColor: done ? colors.primary : colors.surfaceAlt }]}>
                      {done ? <Ionicons name="checkmark" size={16} color={colors.onPrimary} /> : <AppText variant="label">{i + 1}</AppText>}
                    </View>
                    <View style={styles.flex}>
                      <AppText variant="title">{name(id)}</AppText>
                      <AppText variant="caption" color="textSecondary">
                        {done && ind ? `${formatValue(ind)} ${ind.unit}` : locked ? t('measureSession.locked') : isMeasurable(id) ? t('measureSession.withDevice') : t('measureSession.manual')}
                      </AppText>
                    </View>
                    {done && ind ? <StatusBadge status={ind.status} size="sm" /> : !locked && <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
                  </PressableScale>
                </FadeInView>
              );
            })}
          </View>

          {complete ? (
            <View style={{ gap: spacing.sm }}>
              <Button label={t('measureSession.finish')} leftIcon="checkmark-done" size="lg" fullWidth onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
              <Button label={t('measureSession.newSession')} variant="ghost" leftIcon="refresh" onPress={clear} />
            </View>
          ) : (
            next && <Button label={t('measureSession.continueWith', { name: name(next) })} leftIcon="play" size="lg" fullWidth onPress={() => openMeasurement(next)} />
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  num: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
