import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { apiEnabled } from '@/core/config/env';
import { useAppTheme } from '@/core/theme';
import { bmi, type CrewMember, type CrewStatusMember, type RosterMember } from '@/domain/entities/Crew';
import { statusFromServerLevel } from '@/domain/entities/HealthIndicator';
import { Avatar, AppText, Card, FadeInView, IconButton, Screen, StatusBadge } from '@/presentation/components/ui';
import { timeAgo } from '@/presentation/features/health/healthUi';
import { useCrew, useCrewRoster } from '@/presentation/hooks/useCrew';
import { useAuthStore } from '@/presentation/store/authStore';
import { useHealthLogStore } from '@/presentation/store/healthLogStore';
import { worstStatus } from '@/domain/entities/BodySystem';

/**
 * Tripulación.
 * - Con API: roster real y, por GET /crew/status, emergencia abierta y alertas físicas escaladas a la
 *   tripulación (sin valores); el oficial médico ve además el semáforo físico. Nunca maqueta de salud de
 *   otros ni nada de bienestar de nadie.
 * - Sin API (demo): maqueta sintética.
 */
export default function CrewScreen() {
  return apiEnabled() ? <ServerCrew /> : <DemoCrew />;
}

function Header() {
  const { t } = useTranslation();
  const { spacing } = useAppTheme();
  return (
    <FadeInView style={[styles.row, { gap: spacing.md }]}>
      <IconButton icon="arrow-back" tone="filled" accessibilityLabel={t('common.back')} onPress={() => router.back()} />
      <View style={styles.flex}>
        <AppText variant="h1">{t('crew.title')}</AppText>
      </View>
    </FadeInView>
  );
}

function ServerCrew() {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const session = useAuthStore((s) => s.session);
  const { roster, status } = useCrewRoster();
  const byId = new Map((status?.status === 'ok' ? status.crew : []).map((c) => [c.astronautId, c]));

  return (
    <Screen>
      <Header />
      {roster && (
        <FadeInView index={1}>
          <Card tone="night" style={{ gap: 4 }}>
            <AppText variant="label" style={{ color: colors.onNightMuted }}>{t('mission.current')}</AppText>
            <AppText variant="h3" style={{ color: colors.onNight }}>{roster.mission.name}</AppText>
            <AppText variant="caption" style={{ color: colors.onNightMuted }}>
              {roster.mission.code} · {t('mission.crewCount', { count: roster.members.length })}
            </AppText>
          </Card>
        </FadeInView>
      )}

      {status && status.status !== 'ok' && (
        <FadeInView index={1}>
          <Card tone="alt" style={[styles.row, { gap: spacing.md }]}>
            <Ionicons name={status.status === 'offline' ? 'cloud-offline-outline' : 'time-outline'} size={22} color={colors.textSecondary} />
            <View style={styles.flex}>
              <AppText variant="title">{t('crew.healthTitle')}</AppText>
              <AppText variant="bodySmall" color="textSecondary">{t(status.status === 'offline' ? 'crew.statusOffline' : 'crew.comingSoon')}</AppText>
            </View>
          </Card>
        </FadeInView>
      )}

      {!roster && (
        <Card tone="alt">
          <AppText color="textSecondary">{t('crew.rosterUnavailable')}</AppText>
        </Card>
      )}

      {roster?.members.map((m, i) => (
        <FadeInView key={m.astronautId} index={i + 2}>
          <RosterCard member={m} isMe={m.astronautId === session?.astronautId || m.userId === session?.userId} status={byId.get(m.astronautId)} />
        </FadeInView>
      ))}

      <AppText variant="caption" color="textMuted">{t('crew.privacyNote')}</AppText>
    </Screen>
  );
}

function RosterCard({ member, isMe, status }: { member: RosterMember; isMe: boolean; status?: CrewStatusMember }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  return (
    <Card style={{ gap: spacing.md, borderWidth: isMe ? 2 : 1, borderColor: isMe ? colors.primary : colors.border }}>
      <View style={[styles.row, { gap: spacing.md }]}>
        <Avatar name={member.callSign} size={52} />
        <View style={styles.flex}>
          <AppText variant="title">{member.callSign}{isMe ? ` · ${t('crew.you')}` : ''}</AppText>
          <AppText variant="caption" color="textSecondary">
            {member.fullName} · {t(`crewRoles.${member.crewRole}`)}
          </AppText>
        </View>
      </View>

      {status?.emergency && (
        <View style={[styles.row, { gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.status.critical.background }]}>
          <Ionicons name="megaphone" size={16} color={colors.status.critical.solid} />
          <AppText variant="label" style={{ color: colors.status.critical.text }}>
            {t('crew.emergencyOpen', { status: t(`alert.statuses.${status.emergency.status}`, { defaultValue: status.emergency.status }) })}
          </AppText>
        </View>
      )}

      {/* Alertas físicas escaladas a la tripulación: sin valores. */}
      {status?.crewAlerts.map((a) => (
        <View key={a.escalationId} style={[styles.row, { gap: spacing.sm }]}>
          <Ionicons name="pulse" size={16} color={colors.textSecondary} />
          <AppText variant="bodySmall" style={styles.flex}>{a.indicatorName} · {timeAgo(a.createdAt, t)}</AppText>
          <StatusBadge status={statusFromServerLevel(a.level)} size="sm" />
        </View>
      ))}

      {/* Solo el oficial médico recibe `physical` (null para los demás). */}
      {status?.physical && (
        <View style={{ gap: spacing.xs, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }}>
          <AppText variant="caption" color="textMuted">{t('crew.physicalTitle')}</AppText>
          <View style={[styles.wrap, { gap: spacing.xs }]}>
            {status.physical.zones.map((z) => (
              <StatusBadge key={z.zone} status={statusFromServerLevel(z.worstLevel)} label={t(`crew.zones.${z.zone}`, { defaultValue: z.zone })} size="sm" />
            ))}
          </View>
          {status.physical.indicators
            .filter((i) => i.level === 'caution' || i.level === 'critical')
            .map((i) => (
              <View key={i.code} style={[styles.row, { gap: spacing.sm }]}>
                <AppText variant="caption" style={styles.flex}>{i.code}{i.measuredAt ? ` · ${timeAgo(i.measuredAt, t)}` : ''}</AppText>
                <StatusBadge status={statusFromServerLevel(i.level)} size="sm" />
              </View>
            ))}
        </View>
      )}
    </Card>
  );
}

function DemoCrew() {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const { crew, me } = useCrew();
  const alerts = useHealthLogStore((s) => s.alerts);

  return (
    <Screen>
      <Header />

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
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
