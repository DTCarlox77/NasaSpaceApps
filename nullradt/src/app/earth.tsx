import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { BackHeader } from '@/presentation/components/navigation/BackHeader';
import { AppText, Card, FadeInView, Screen, SegmentedControl } from '@/presentation/components/ui';
import { formatDuration, useNow } from '@/presentation/hooks/useNow';
import { useAuthStore } from '@/presentation/store/authStore';
import { globalRoleOf } from '@/domain/entities/Session';
import { deliveredFor, messageStatus, useOutboxStore, type Audience } from '@/presentation/store/outboxStore';

const ROLE_TO_AUDIENCE: Partial<Record<string, Audience>> = { admin: 'missionControl', flight_surgeon: 'flightSurgeon', behavioral_health: 'behavioralHealth' };

/**
 * Bandeja de Tierra: lo que cada equipo en Tierra ha RECIBIDO hasta ahora (la réplica llega con retraso).
 * Cada rol ve solo lo suyo: control de misión → cumplimiento, aptitud, emergencias y auditoría;
 * flight surgeon → escalamientos médicos y reportes de triaje; salud conductual → bienestar confidencial.
 */
export default function EarthInboxScreen() {
  const { t, i18n } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const role = useAuthStore((s) => (s.session ? globalRoleOf(s.session) : 'astronaut'));
  const fixed = ROLE_TO_AUDIENCE[role];
  const [picked, setPicked] = useState<Audience>(fixed ?? 'flightSurgeon');
  const audience = fixed ?? picked;
  const messages = useOutboxStore((s) => s.messages);
  const now = useNow(2000);
  const inbox = deliveredFor(messages, audience, now);
  const pending = messages.filter((m) => m.audience === audience && m.direction === 'toEarth' && messageStatus(m, now) !== 'delivered');

  return (
    <Screen>
      <BackHeader title={t('earth.title')} subtitle={fixed ? t(`comms.audience.${audience}`) : t('earth.demoSubtitle')} />

      {!fixed && (
        <FadeInView index={1}>
          <SegmentedControl<Audience>
            value={picked}
            onChange={setPicked}
            options={[
              { value: 'missionControl', label: t('earth.short.missionControl') },
              { value: 'flightSurgeon', label: t('earth.short.flightSurgeon') },
              { value: 'behavioralHealth', label: t('earth.short.behavioralHealth') },
            ]}
          />
        </FadeInView>
      )}

      <Card tone="alt" style={{ gap: spacing.xs }}>
        <AppText variant="bodySmall">{t(`earth.scope.${audience}`)}</AppText>
        {pending.length > 0 && <AppText variant="caption" color="accentText">{t('earth.pending', { count: pending.length })}</AppText>}
      </Card>

      {inbox.length === 0 && <AppText color="textSecondary">{t('earth.empty')}</AppText>}
      {inbox.map((m, i) => (
        <FadeInView key={m.id} index={i}>
          <Card style={{ gap: spacing.sm }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              {m.confidential && <Ionicons name="lock-closed" size={14} color={colors.primaryText} />}
              <AppText variant="title" style={styles.flex}>{m.title}</AppText>
            </View>
            <AppText variant="bodySmall" color="textSecondary">{m.body}</AppText>
            <AppText variant="caption" color="textMuted">
              {t('earth.receivedAt', {
                sent: new Date(m.createdAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                delay: formatDuration((m.deliverAt ?? m.createdAt) - m.createdAt),
              })}
            </AppText>
          </Card>
        </FadeInView>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center' } });
