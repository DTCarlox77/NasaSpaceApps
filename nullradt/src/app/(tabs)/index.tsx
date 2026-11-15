import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { palette, useAppTheme, type StatusKey } from '@/core/theme';
import type { HazardId } from '@/domain/entities/Hazard';
import type { BodySystemId, HealthStatus } from '@/domain/entities/HealthIndicator';
import { BodyFigure } from '@/presentation/components/health/BodyFigure';
import { Disclaimer } from '@/presentation/components/feedback/Disclaimer';
import { AppText, Avatar, Button, Card, FadeInView, ProgressBar, Screen, StatusBadge } from '@/presentation/components/ui';
import { IndicatorRow, IndicatorTile, StatusLegend, SystemIcon } from '@/presentation/features/health/healthUi';
import { useHazards } from '@/presentation/hooks/useHazards';
import { useHealthOverview } from '@/presentation/hooks/useHealthOverview';
import { useCurrentMission } from '@/presentation/hooks/useMissions';
import { useMissionStatus } from '@/presentation/hooks/useMissionStatus';
import { useAuthStore } from '@/presentation/store/authStore';
import { useCrew, useCrewRoster } from '@/presentation/hooks/useCrew';
import { apiEnabled } from '@/core/config/env';
import { indicatorKey } from '@/domain/entities/HealthIndicator';
import { useCheckInStore } from '@/presentation/store/checkInStore';
import { todayKey } from '@/presentation/store/routineStore';
import { useUiStore } from '@/presentation/store/uiStore';

const HAZARD_ICONS: Record<HazardId, keyof typeof Ionicons.glyphMap> = {
  radiation: 'nuclear-outline',
  isolation: 'people-outline',
  distance: 'planet-outline',
  gravity: 'barbell-outline',
  environment: 'thermometer-outline',
};

const OVERVIEW_ORDER: StatusKey[] = ['normal', 'caution', 'critical', 'unevaluated'];

const greetingKey = () => {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 19 ? 'afternoon' : 'evening';
};

/** Inicio (Figma "Dashboard"). Los datos de salud vienen del backend; sin API se usa la maqueta del Figma. */
export default function HomeScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const { overview } = useHealthOverview();
  const hazards = useHazards();
  const mission = useMissionStatus();
  const currentMission = useCurrentMission();
  const displayName = useAuthStore((s) => s.session?.displayName ?? '');
  const firstName = displayName.split(' ')[0] ?? '';
  const { selectedSystem, setSelectedSystem } = useUiStore();
  const { crew, me } = useCrew();
  const { roster } = useCrewRoster();
  const session = useAuthStore((s) => s.session);
  const userId = useAuthStore((s) => s.session?.userId ?? '');
  const checkedToday = useCheckInStore((s) => !!s.entries[userId]?.[todayKey()]);

  const statuses = useMemo(
    () => Object.fromEntries((overview?.systems ?? []).map((s) => [s.id, s.status])) as Record<BodySystemId, HealthStatus>,
    [overview],
  );
  const system = overview?.systems.find((s) => s.id === selectedSystem);
  const attention = overview?.needsAttention.length ?? 0;
  const openSystem = (id: BodySystemId) => {
    setSelectedSystem(id);
    router.navigate('/body');
  };

  return (
    <Screen topInset={false}>
      {/* Saludo */}
      <FadeInView style={{ gap: spacing.sm }}>
        {currentMission && (
          <AppText variant="label" style={{ color: colors.onSecondary }}>
            {t('home.missionEyebrow', { mission: currentMission.name, day: currentMission.day })}
          </AppText>
        )}
        <AppText variant="h1">{t(`home.greeting.${greetingKey()}`, { name: firstName })}</AppText>
        {overview && (
          <AppText color="textSecondary">
            {attention === 0 ? t('home.allInRange') : t('home.needAttention', { count: attention })}
          </AppText>
        )}
        <View style={[styles.row, { gap: spacing.sm, marginTop: spacing.xs, flexWrap: 'wrap' }]}>
          <Button label={t('home.dailyCheckInBtn')} variant="outline" leftIcon="heart-outline" onPress={() => router.navigate('/wellbeing')} />
          <Button
            label={t('home.registerMeasurement')}
            leftIcon="add"
            onPress={() => router.push({ pathname: '/measure', params: { indicator: 'bloodPressure' } })}
          />
        </View>
      </FadeInView>

      {/* Check diario + tripulación */}
      <FadeInView index={1} style={{ gap: spacing.md }}>
        <Card onPress={() => router.navigate('/wellbeing')} accessibilityLabel={t('home.dailyCheckInBtn')} style={[styles.row, { gap: spacing.md, borderWidth: 1, borderColor: checkedToday ? colors.status.normal.ring : colors.status.caution.ring }]}>
          <View style={[styles.iconTile, { backgroundColor: checkedToday ? colors.status.normal.background : colors.status.caution.background, borderRadius: radius.md }]}>
            <Ionicons name={checkedToday ? 'checkmark-done' : 'heart-outline'} size={22} color={checkedToday ? colors.status.normal.text : colors.status.caution.text} />
          </View>
          <View style={styles.flex}>
            <AppText variant="title">{t('home.dailyCheckInBtn')}</AppText>
            <AppText variant="bodySmall" color="textSecondary">{checkedToday ? t('home.checkDone') : t('home.checkPending')}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </Card>
        {apiEnabled() && roster && roster.members.length > 0 && (
          <Card onPress={() => router.push('/crew')} accessibilityLabel={t('crew.title')} style={{ gap: spacing.md }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Ionicons name="people-outline" size={20} color={colors.primaryText} />
              <AppText variant="h3" style={styles.flex}>{t('home.crewTitle')}</AppText>
            </View>
            {roster.members.map((m) => (
              <View key={m.astronautId} style={[styles.row, { gap: spacing.md }]}>
                <Avatar name={m.callSign} size={40} />
                <View style={styles.flex}>
                  <AppText variant="title">{m.callSign}{m.astronautId === session?.astronautId ? ` · ${t('crew.you')}` : ''}</AppText>
                  <AppText variant="caption" color="textSecondary">{t(`crewRoles.${m.crewRole}`)}</AppText>
                </View>
              </View>
            ))}
          </Card>
        )}
        {crew.length > 0 && (
          <Card onPress={() => router.push('/crew')} accessibilityLabel={t('crew.title')} style={{ gap: spacing.md }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Ionicons name="people-outline" size={20} color={colors.primaryText} />
              <AppText variant="h3" style={styles.flex}>{t('home.crewTitle')}</AppText>
            </View>
            {crew.map((m) => (
              <View key={m.id} style={[styles.row, { gap: spacing.md }]}>
                <Avatar name={m.displayName} size={40} />
                <View style={styles.flex}>
                  <AppText variant="title">{m.displayName}{m.id === me?.id ? ` · ${t('crew.you')}` : ''}</AppText>
                  <AppText variant="caption" color="textSecondary">{t(`crew.specialty.${m.specialty}`)} · {t('crew.module', { module: m.module })}</AppText>
                </View>
                <View style={[styles.onlineDot, { backgroundColor: colors.primary }]} />
              </View>
            ))}
          </Card>
        )}
      </FadeInView>

      {/* Sistemas del cuerpo */}
      {overview && (
        <FadeInView index={1}>
          <Card style={{ gap: spacing.lg }}>
            <View style={{ gap: 2 }}>
              <AppText variant="caption" color="textMuted">{t('home.tapSystem')}</AppText>
              <AppText variant="h3">{t('home.bodySystems')}</AppText>
            </View>
            <StatusLegend />
            <BodyFigure statuses={statuses} selected={selectedSystem} onSelect={setSelectedSystem} height={400} />
            <Button label={t('body3d.open')} variant="dark" leftIcon="cube-outline" fullWidth onPress={() => router.push('/body-3d')} />
            {system && (
              <View style={{ gap: spacing.md, padding: spacing.lg, borderRadius: radius.button, backgroundColor: colors.surfaceAlt }}>
                <View style={[styles.row, { gap: spacing.md }]}>
                  <View style={[styles.iconTile, { backgroundColor: colors.surface, borderRadius: radius.md }]}>
                    <SystemIcon id={system.id} color={colors.primaryText} />
                  </View>
                  <View style={[styles.flex, { gap: 4 }]}>
                    <AppText variant="title">{t(`systems.${system.id}.name`)}</AppText>
                    <StatusBadge status={system.status} size="sm" />
                  </View>
                </View>
                <AppText variant="bodySmall" color="textSecondary" numberOfLines={3}>{t(`systems.${system.id}.role`)}</AppText>
                {system.indicators.map((ind) => (
                  <IndicatorRow key={indicatorKey(ind)} indicator={ind} onPress={() => openSystem(system.id)} />
                ))}
                <Button label={t('home.exploreSystem')} variant="secondary" fullWidth onPress={() => openSystem(system.id)} />
              </View>
            )}
          </Card>
        </FadeInView>
      )}

      {/* Todos los indicadores */}
      {overview && (
        <FadeInView index={2} style={{ gap: spacing.md }}>
          <AppText variant="h3">{t('home.allIndicators')}</AppText>
          <View style={[styles.wrap, { gap: spacing.md }]}>
            {overview.indicators.map((ind) => (
              <View key={indicatorKey(ind)} style={styles.gridItem}>
                <IndicatorTile indicator={ind} onPress={() => openSystem(ind.systemId)} />
              </View>
            ))}
          </View>
        </FadeInView>
      )}

      {/* Resumen de salud */}
      {overview && (
        <FadeInView index={3}>
          <Card style={{ gap: spacing.lg }}>
            <View style={{ gap: 2 }}>
              <AppText variant="caption" color="textMuted">{t('home.tracked', { count: overview.indicators.length })}</AppText>
              <AppText variant="h3">{t('home.healthOverview')}</AppText>
            </View>
            <View style={[styles.row, styles.bar, { borderRadius: radius.pill, backgroundColor: colors.progressTrack }]}>
              {OVERVIEW_ORDER.filter((s) => overview.counts[s] > 0).map((s) => (
                <View key={s} style={{ flex: overview.counts[s], backgroundColor: colors.status[s].solid }} />
              ))}
            </View>
            <View style={[styles.wrap, { gap: spacing.sm }]}>
              {OVERVIEW_ORDER.map((s) => (
                <View key={s} style={[styles.countTile, { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.status[s].background }]}>
                  <AppText variant="h2" style={{ color: colors.status[s].text }}>{overview.counts[s]}</AppText>
                  <AppText variant="caption" style={{ color: colors.status[s].text }}>{t(`status.${s}`)}</AppText>
                </View>
              ))}
            </View>
            {overview.needsAttention.length > 0 && (
              <View style={{ gap: spacing.sm }}>
                <AppText variant="label">{t('home.needsAttentionTitle')}</AppText>
                {overview.needsAttention.map((ind) => (
                  <IndicatorRow key={indicatorKey(ind)} indicator={ind} onPress={() => openSystem(ind.systemId)} />
                ))}
              </View>
            )}
            <AppText variant="caption" color="textMuted">{t('home.protocolScreening')}</AppText>
          </Card>
        </FadeInView>
      )}

      {/* Progreso de hoy + misión */}
      {mission && currentMission && (
        <FadeInView index={4}>
          <Card tone="night" style={{ gap: spacing.md }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Ionicons name="rocket-outline" size={18} color={colors.primary} />
              <AppText variant="label" style={{ color: colors.onNightMuted }}>{t('home.missionProgress')}</AppText>
            </View>
            <AppText variant="h3" style={{ color: colors.onNight }}>{currentMission.name}</AppText>
            <AppText style={{ color: colors.onNightMuted }}>
              {currentMission.totalDays ? t('mission.dayOf', { day: currentMission.day, total: currentMission.totalDays }) : t('mission.dayOnly', { day: currentMission.day })}
            </AppText>
            {currentMission.totalDays > 0 && <ProgressBar value={currentMission.day / currentMission.totalDays} color={colors.primary} onDark />}
            <View style={[styles.row, { gap: spacing.lg, marginTop: spacing.sm }]}>
              <View style={styles.flex}>
                <ProgressBar
                  value={mission.checkInsPlanned ? Math.min(mission.checkInsDone / mission.checkInsPlanned, 1) : 0}
                  color={palette.orange[300]}
                  label={t('home.dailyCheckIn', { done: mission.checkInsDone, total: mission.checkInsPlanned })}
                  onDark
                />
              </View>
              <View style={styles.flex}>
                <ProgressBar value={Math.min(mission.streakDays / 30, 1)} color={palette.lime[300]} label={t('home.streak', { count: mission.streakDays })} delay={150} onDark />
              </View>
            </View>
          </Card>
        </FadeInView>
      )}

      {/* Los 5 peligros (NASA HRP) — requisito del reto */}
      <View style={{ gap: spacing.md }}>
        <FadeInView index={5}>
          <AppText variant="h3">{t('home.hazardsTitle')}</AppText>
        </FadeInView>
        {hazards.map((h, i) => (
          <FadeInView key={h.id} index={6 + i}>
            <Card tone="alt" style={[styles.row, { gap: spacing.md, padding: spacing.lg }]}>
              <View style={[styles.iconTile, { backgroundColor: colors.surface, borderRadius: radius.md }]}>
                <Ionicons name={HAZARD_ICONS[h.id]} size={22} color={colors.tertiary} />
              </View>
              <View style={styles.flex}>
                <AppText variant="title">{t(`hazards.${h.id}.title`)}</AppText>
                <AppText variant="bodySmall" color="textSecondary">{t(`hazards.${h.id}.summary`)}</AppText>
              </View>
              <AppText variant="h3" color="textMuted">{h.letter}</AppText>
            </Card>
          </FadeInView>
        ))}
      </View>

      <Disclaimer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  gridItem: { flexBasis: '45%', flexGrow: 1 },
  iconTile: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  bar: { height: 12, overflow: 'hidden' },
  countTile: { flexBasis: '45%', flexGrow: 1 },
  onlineDot: { width: 10, height: 10, borderRadius: 5 },
});
