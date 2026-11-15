import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import i18n from '@/core/i18n';
import { useAppTheme } from '@/core/theme';
import { LINK_PROFILES, roundTripSec } from '@/domain/comms/linkModel';
import { BackHeader } from '@/presentation/components/navigation/BackHeader';
import { AppText, Button, Card, Screen, SegmentedControl, VoiceNoteInput } from '@/presentation/components/ui';
import { formatDuration, useNow } from '@/presentation/hooks/useNow';
import { useAuthStore } from '@/presentation/store/authStore';
import { messageStatus, useOutboxStore } from '@/presentation/store/outboxStore';

type Kind = 'message' | 'session';

/**
 * "Quiero hablar con alguien": mensaje o solicitud de sesión con salud conductual en Tierra.
 * Con el retraso REAL del enlace (se muestra). Confidencial e invisible para la tripulación:
 * no genera avisos a bordo ni aparece en las alertas compartidas.
 */
export default function TalkScreen() {
  const { t, i18n: i18nInst } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const session = useAuthStore((s) => s.session);
  const userId = session?.userId ?? '';
  const threadId = `bh-${userId}`;
  const messages = useOutboxStore((s) => s.messages);
  const profile = useOutboxStore((s) => s.profile);
  const send = useOutboxStore((s) => s.send);
  const now = useNow(1000);
  const [kind, setKind] = useState<Kind>('message');
  const [text, setText] = useState('');

  const thread = useMemo(() => messages.filter((m) => m.threadId === threadId).sort((a, b) => a.createdAt - b.createdAt), [messages, threadId]);
  // Las respuestas de Tierra solo se ven cuando realmente llegaron.
  const visible = thread.filter((m) => m.direction === 'toEarth' || messageStatus(m, now) === 'delivered');
  const rtt = roundTripSec(LINK_PROFILES[profile]) * 1000;

  const submit = () => {
    const body = text.trim() || t('wellbeingPlus.talk.sessionDefault');
    const out = send({
      kind: 'talkRequest',
      audience: 'behavioralHealth',
      fromId: userId,
      subjectId: userId,
      confidential: true,
      threadId,
      title: kind === 'session' ? i18n.t('wellbeingPlus.talk.sessionTitle', { name: session?.displayName }) : i18n.t('wellbeingPlus.talk.messageTitle', { name: session?.displayName }),
      body,
    });
    // Acuse SINTÉTICO de salud conductual (demo): se redacta 1 min después de recibirlo y vuelve con el mismo retraso.
    if (out.deliverAt) {
      send({
        kind: 'reply',
        direction: 'toCrew',
        audience: 'behavioralHealth',
        fromId: 'NR-A-9003',
        subjectId: userId,
        confidential: true,
        threadId,
        createdAt: out.deliverAt + 60_000,
        title: i18n.t('wellbeingPlus.talk.replyTitle'),
        body: kind === 'session' ? i18n.t('wellbeingPlus.talk.replySession') : i18n.t('wellbeingPlus.talk.replyMessage'),
        synthetic: true,
      });
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setText('');
  };

  return (
    <Screen>
      <BackHeader title={t('wellbeingPlus.talk.title')} subtitle={t('wellbeingPlus.talk.subtitle')} fallback="/wellbeing" />

      <Card tone="alt" style={[styles.row, { gap: spacing.sm }]}>
        <Ionicons name="eye-off-outline" size={20} color={colors.primaryText} />
        <AppText variant="bodySmall" style={styles.flex}>{t('wellbeingPlus.talk.invisible')}</AppText>
      </Card>

      <Card style={[styles.row, { gap: spacing.sm }]}>
        <Ionicons name="time-outline" size={20} color={colors.accentText} />
        <AppText variant="bodySmall" style={styles.flex}>{t('wellbeingPlus.talk.delay', { rtt: formatDuration(rtt) })}</AppText>
      </Card>

      <View style={{ gap: spacing.sm }}>
        {visible.length === 0 && <AppText color="textSecondary">{t('wellbeingPlus.talk.empty')}</AppText>}
        {visible.map((m) => {
          const mine = m.direction === 'toEarth';
          const st = messageStatus(m, now);
          return (
            <View
              key={m.id}
              style={{
                alignSelf: mine ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                padding: spacing.md,
                gap: 4,
                borderRadius: radius.button,
                backgroundColor: mine ? colors.surfaceSage : colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              {!mine && <AppText variant="label" color="primaryText">{t('wellbeingPlus.talk.bh')}{m.synthetic ? ` · ${t('common.syntheticData')}` : ''}</AppText>}
              <AppText>{m.body}</AppText>
              <AppText variant="caption" color="textMuted">
                {new Date(m.createdAt).toLocaleTimeString(i18nInst.language, { hour: '2-digit', minute: '2-digit' })}
                {mine && ` · ${st === 'delivered' ? t('comms.status.delivered') : st === 'queued' ? t('comms.status.queued') : t('comms.eta', { eta: formatDuration((m.deliverAt ?? now) - now) })}`}
              </AppText>
            </View>
          );
        })}
      </View>

      <Card style={{ gap: spacing.md }}>
        <SegmentedControl<Kind>
          value={kind}
          onChange={setKind}
          options={[
            { value: 'message', label: t('wellbeingPlus.talk.message'), icon: 'chatbubble-outline' },
            { value: 'session', label: t('wellbeingPlus.talk.session'), icon: 'videocam-outline' },
          ]}
        />
        <VoiceNoteInput value={text} onChangeText={setText} placeholder={kind === 'session' ? t('wellbeingPlus.talk.sessionPlaceholder') : t('wellbeingPlus.talk.placeholder')} />
        <Button label={kind === 'session' ? t('wellbeingPlus.talk.requestSession') : t('wellbeingPlus.talk.send')} leftIcon="send" size="lg" fullWidth disabled={kind === 'message' && !text.trim()} onPress={submit} />
      </Card>
      <AppText variant="caption" color="textMuted">{t('wellbeingPlus.talk.crisis')}</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center' } });
