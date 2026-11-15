import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { bmi, type CrewMember } from '@/domain/entities/Crew';
import { Avatar, AppText, Card, FadeInView, IconButton, Screen, StatusBadge } from '@/presentation/components/ui';
import { timeAgo } from '@/presentation/features/health/healthUi';
import { useCrew } from '@/presentation/hooks/useCrew';
import { useHealthLogStore } from '@/presentation/store/healthLogStore';
import { worstStatus } from '@/domain/entities/BodySystem';

/** Tripulación: datos de cada tripulante y alertas compartidas (sintético en la demo). */
export default function CrewScreen() {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const { crew, me } = useCrew();
  const alerts = useHealthLogStore((s) => s.alerts);

  return (
    <Screen>
      <FadeInView style={[styles.row, { gap: spacing.md }]}>
        <IconButton icon="arrow-back" tone="filled" accessibilityLabel={t('common.back')} onPress={() => router.back()} />
        <View style={styles.flex}>
          <AppText variant="h1">{t('crew.title')}</AppText>
        </View>
      </FadeInView>

      {crew.map((m, i) => (
        <FadeInView key={m.id} index={i + 1}>
          <MemberCard member={m} isMe={m.id === me?.id} />
        </FadeInView>
      ))}

      <FadeInView index={crew.length + 1} style={{ gap: spacing.sm }}>
        <AppText variant="h3">{t('crew.alertsTitle')}</AppText>
        {alerts.length === 0 ? (
          <Card tone="alt">
            <AppText color="textSecondary">{t('crew.noAlerts')}</AppText>
          </Card>
        ) : (
          alerts.slice(0, 10).map((a) => (
            <Card key={a.id} tone="alt" style={[styles.row, { gap: spacing.md, opacity: a.cancelledAt ? 0.6 : 1 }]}>
              <Ionicons
                name={a.cancelledAt ? 'close-circle-outline' : a.kind === 'sos' ? 'megaphone' : 'pulse'}
                size={22}
                color={a.cancelledAt ? colors.textMuted : colors.status[a.severity].solid}
              />
              <View style={styles.flex}>
                <AppText variant="title">
                  {a.kind === 'sos' ? t('crew.sosFrom', { name: a.fromName }) : t('crew.measurementFrom', { name: a.fromName, what: t(`indicators.${a.indicatorId!}.short`) })}
                </AppText>
                <AppText variant="caption" color="textSecondary">
                  {[a.value, timeAgo(a.createdAt, t), a.cancelledAt ? t('crew.cancelled') : null].filter(Boolean).join(' · ')}
                </AppText>
              </View>
              {!a.cancelledAt && <StatusBadge status={a.severity} size="sm" />}
            </Card>
          ))
        )}
      </FadeInView>
    </Screen>
  );
}

function MemberCard({ member, isMe }: { member: CrewMember; isMe: boolean }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const readings = useHealthLogStore((s) => s.readings[member.id]);
  const status = readings?.length ? worstStatus(readings.slice(-5).map((r) => r.status)) : 'normal';

  return (
    <Card style={{ gap: spacing.md, borderWidth: isMe ? 2 : 1, borderColor: isMe ? colors.primary : colors.border }}>
      <View style={[styles.row, { gap: spacing.md }]}>
        <Avatar name={member.displayName} size={52} />
        <View style={styles.flex}>
          <AppText variant="title">{member.fullName}</AppText>
          <AppText variant="caption" color="textSecondary">
            {t(`crew.specialty.${member.specialty}`)} · {member.id}
            {isMe ? ` · ${t('crew.you')}` : ''}
          </AppText>
        </View>
        <StatusBadge status={status} size="sm" />
      </View>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Fact label={t('crew.age')} value={t('crew.years', { count: member.age })} />
        <Fact label={t('crew.sex')} value={t(`crew.sexes.${member.sex}`)} />
        <Fact label={t('crew.height')} value={`${member.heightM.toFixed(2)} m`} />
        <Fact label={t('crew.weight')} value={`${member.weightKg} kg`} />
      </View>
      <View style={[styles.row, { gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }]}>
        <Ionicons name="water" size={16} color={colors.status.critical.solid} />
        <AppText variant="label">{member.bloodType}</AppText>
        <Ionicons name="location-outline" size={16} color={colors.textSecondary} style={{ marginLeft: spacing.sm }} />
        <AppText variant="caption" color="textSecondary" style={styles.flex}>{t('crew.module', { module: member.module })}</AppText>
        <AppText variant="caption" color="textMuted">{t('crew.bmi', { value: bmi(member).toFixed(1) })}</AppText>
      </View>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const { colors, spacing, radius } = useAppTheme();
  return (
    <View style={[styles.flex, { padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }]}>
      <AppText variant="label" numberOfLines={1}>{value}</AppText>
      <AppText variant="caption" color="textMuted" numberOfLines={1}>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
