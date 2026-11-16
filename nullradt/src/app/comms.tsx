import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { isBlackout, LINK_PROFILES, nextLinkWindow, type LinkProfileId } from '@/domain/comms/linkModel';
import { BackHeader } from '@/presentation/components/navigation/BackHeader';
import { AppText, Button, Card, FadeInView, Screen, SegmentedControl, ToggleRow } from '@/presentation/components/ui';
import { formatDuration, useNow } from '@/presentation/hooks/useNow';
import { messageStatus, useOutboxStore, type MessageStatus } from '@/presentation/store/outboxStore';

const STATUS_ICON: Record<MessageStatus, keyof typeof Ionicons.glyphMap> = {
  queued: 'pause-circle-outline',
  inTransit: 'paper-plane-outline',
  delivered: 'checkmark-done-circle',
};

/**
 * Comunicaciones con Tierra: el servidor a bordo es la fuente de verdad y se replica a Tierra con retraso.
 * Aquí se ve el enlace (retraso de la luz y cortes) y la cola de salida con compute_deliver_at.
 */
export default function CommsScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const { messages, profile, forcedOffline, setProfile, setForcedOffline, clearDelivered } = useOutboxStore();
  const now = useNow(1000);
  const p = LINK_PROFILES[profile];
  const down = isBlackout(now, p, forcedOffline);
  const back = forcedOffline ? null : nextLinkWindow(now, p);
  const outgoing = messages.filter((m) => m.direction === 'toEarth');

  return (
    <Screen>
      <BackHeader title={t('comms.title')} subtitle={t('comms.subtitle')} />

      <FadeInView index={1}>
        <Card tone="night" style={{ gap: spacing.md }}>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Ionicons name={down ? 'cloud-offline' : 'radio'} size={22} color={down ? colors.accent : colors.primary} />
            <AppText variant="h3" style={[styles.flex, { color: colors.onNight }]}>{down ? t('comms.linkDown') : t('comms.linkUp')}</AppText>
          </View>
          <AppText style={{ color: colors.onNightMuted }}>{t('comms.delay', { delay: formatDuration(p.oneWayDelaySec * 1000) })}</AppText>
          {down && back && <AppText style={{ color: colors.onNightMuted }}>{t('comms.backIn', { eta: formatDuration(back - now) })}</AppText>}
          {p.periodMin > 0 && <AppText variant="caption" style={{ color: colors.onNightMuted }}>{t('comms.windows', { period: p.periodMin, blackout: p.blackoutMin })}</AppText>}
        </Card>
      </FadeInView>

      <FadeInView index={2}>
        <Card style={{ gap: spacing.md }}>
          <AppText variant="title">{t('comms.profile')}</AppText>
          <SegmentedControl<LinkProfileId>
            value={profile}
            onChange={setProfile}
            options={(Object.keys(LINK_PROFILES) as LinkProfileId[]).map((id) => ({ value: id, label: t(`comms.profiles.${id}`) }))}
          />
          <AppText variant="caption" color="textMuted">{t(`comms.profileHint.${profile}`)}</AppText>
          <ToggleRow icon="cloud-offline-outline" title={t('comms.forceOffline')} description={t('comms.forceOfflineBody')} value={forcedOffline} onValueChange={setForcedOffline} />
        </Card>
      </FadeInView>

      <FadeInView index={3} style={{ gap: spacing.sm }}>
        <View style={[styles.row, { gap: spacing.sm }]}>
          <AppText variant="h3" style={styles.flex}>{t('comms.outbox')}</AppText>
          <Button label={t('comms.earthInbox')} variant="ghost" size="sm" leftIcon="planet-outline" onPress={() => router.push('/earth')} />
        </View>
        {outgoing.length === 0 && <AppText color="textSecondary">{t('comms.empty')}</AppText>}
        {outgoing.slice(0, 30).map((m) => {
          const st = messageStatus(m, now);
          return (
            <Card key={m.id} tone="alt" style={[styles.row, { gap: spacing.md, padding: spacing.md }]}>
              <Ionicons name={STATUS_ICON[st]} size={24} color={st === 'delivered' ? colors.primaryText : st === 'queued' ? colors.textMuted : colors.accentText} />
              <View style={styles.flex}>
                <View style={[styles.row, { gap: 4 }]}>
                  {m.confidential && <Ionicons name="lock-closed" size={12} color={colors.textMuted} />}
                  <AppText variant="title" numberOfLines={1} style={styles.flex}>{m.title}</AppText>
                </View>
                <AppText variant="caption" color="textSecondary">
                  {t(`comms.audience.${m.audience}`)} · {st === 'inTransit' ? t('comms.eta', { eta: formatDuration((m.deliverAt ?? now) - now) }) : t(`comms.status.${st}`)}
                </AppText>
              </View>
              <View style={{ paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.surface }}>
                <AppText variant="caption" color="textMuted">{t(`comms.kinds.${m.kind}`)}</AppText>
              </View>
            </Card>
          );
        })}
        {outgoing.length > 0 && <Button label={t('comms.clear')} variant="ghost" size="sm" leftIcon="trash-outline" onPress={clearDelivered} />}
      </FadeInView>
    </Screen>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center' } });
