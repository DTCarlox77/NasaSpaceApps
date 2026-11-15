import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import type { Mission, MissionPhase } from '@/domain/entities/Mission';
import { AppText, Button, PressableScale, ProgressBar } from '@/presentation/components/ui';
import { useMissions } from '@/presentation/hooks/useMissions';
import { useSettingsStore } from '@/presentation/store/settingsStore';

/** Paso 2 del login (Figma): elegir misión. Solo una misión activa abre el expediente de salud. */
export function MissionStep({ onBack, onContinue }: { onBack: () => void; onContinue: () => void }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const missions = useMissions();
  const { selectedMissionId, setSelectedMissionId } = useSettingsStore();
  const [selected, setSelected] = useState<string | null>(selectedMissionId);

  useEffect(() => {
    if (!selected && missions.length) setSelected(missions.find((m) => m.phase === 'active')?.id ?? missions[0]!.id);
  }, [missions, selected]);

  const mission = missions.find((m) => m.id === selected);
  const active = mission?.phase === 'active';

  return (
    <View style={{ gap: spacing.xl }}>
      <View style={{ gap: spacing.xs }}>
        <AppText variant="h1">{t('mission.selectTitle')}</AppText>
        <AppText color="textSecondary">{t('mission.selectBody')}</AppText>
      </View>

      <View accessibilityRole="radiogroup" style={{ gap: spacing.md }}>
        {missions.map((m) => (
          <MissionCard key={m.id} mission={m} selected={m.id === selected} onPress={() => setSelected(m.id)} />
        ))}
      </View>

      {mission && (
        <View style={{ gap: spacing.md, padding: spacing.xl, borderRadius: radius.button, backgroundColor: colors.surfaceSage, borderWidth: 1, borderColor: colors.border }}>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Ionicons name="rocket-outline" size={20} color={colors.tertiary} />
            <AppText variant="caption" color="textMuted">{t('mission.current')}</AppText>
          </View>
          <AppText variant="title">{mission.name}</AppText>
          <InfoRow label={t('mission.day')} value={active ? t('mission.dayOf', { day: mission.day, total: mission.totalDays }) : '—'} />
          <InfoRow label={t('mission.crew')} value={t('mission.crewCount', { count: mission.crew })} />
          <InfoRow label={t('mission.location')} value={mission.location} />
          {active && <ProgressBar value={mission.day / mission.totalDays} color={colors.primary} />}
        </View>
      )}

      {!active && mission && <AppText variant="bodySmall" color="textMuted">{t('mission.notStarted')}</AppText>}

      <View style={[styles.row, { gap: spacing.sm }]}>
        <Button label={t('common.back')} variant="outline" size="lg" leftIcon="arrow-back" onPress={onBack} />
        <View style={styles.flex}>
          <Button
            label={active ? t('mission.continue') : t('mission.notAvailable')}
            icon={active ? 'arrow-forward' : undefined}
            size="lg"
            fullWidth
            disabled={!active}
            onPress={() => {
              if (!mission) return;
              setSelectedMissionId(mission.id);
              onContinue();
            }}
          />
        </View>
      </View>
    </View>
  );
}

export function MissionCard({ mission, selected, onPress }: { mission: Mission; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const { colors, spacing, radius, shadows } = useAppTheme();
  const chip: Record<MissionPhase, { bg: string; fg: string }> = {
    active: { bg: colors.primarySoft, fg: colors.primaryText },
    scheduled: { bg: colors.secondary, fg: colors.onSecondary },
    training: { bg: colors.surfaceAlt, fg: colors.textSecondary },
  };

  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${mission.name}, ${t(`mission.phase.${mission.phase}`)}`}
      onPress={onPress}
      style={[
        styles.row,
        selected ? shadows.md : null,
        {
          gap: spacing.md,
          padding: spacing.lg,
          borderRadius: radius.button,
          backgroundColor: colors.surface,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? colors.primaryStrong : colors.border,
        },
      ]}
    >
      <View style={[styles.radio, { borderColor: selected ? colors.primaryStrong : colors.borderStrong, backgroundColor: selected ? colors.primaryStrong : 'transparent' }]}>
        {selected && <View style={styles.radioDot} />}
      </View>
      <View style={[styles.flex, { gap: 2 }]}>
        <AppText variant="title">{mission.name}</AppText>
        <AppText variant="bodySmall" color="textMuted">{mission.vehicle}</AppText>
      </View>
      <View style={{ backgroundColor: chip[mission.phase].bg, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
        <AppText variant="label" style={{ color: chip[mission.phase].fg, fontSize: 12 }}>{t(`mission.phase.${mission.phase}`)}</AppText>
      </View>
    </PressableScale>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <AppText variant="bodySmall" color="textMuted">{label}</AppText>
      <AppText variant="label" style={styles.infoValue}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  infoValue: { flexShrink: 1, textAlign: 'right' },
});
