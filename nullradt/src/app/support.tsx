import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import type { SupportChannel, SupportSuggestion, SupportUrgency } from '@/domain/entities/Wellbeing';
import { container } from '@/di/container';
import { AppText, Button, Card, FadeInView, IconButton, Screen, SegmentedControl, VoiceNoteInput } from '@/presentation/components/ui';
import { useAuthStore } from '@/presentation/store/authStore';
import { useSupportStore, type SupportThread } from '@/presentation/store/supportStore';
import { showToast } from '@/presentation/store/toastStore';
import { refreshPendingCount, runSync } from '@/presentation/sync/syncEngine';

const NO_THREADS: SupportThread[] = [];
const hhmm = (iso: string, lang: string) => new Date(iso).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });

/**
 * "Quiero hablar con alguien" (guía §11, confidencial). POST /wellbeing/support-requests o, sin conexión,
 * la cola de sync. Nadie de la tripulación la ve. Con urgencia "ahora" se muestran las sugerencias del
 * servidor, que NO avisan a nadie a bordo. Las respuestas de salud conductual llegan por /sync/pull.
 */
export default function SupportScreen() {
  const { t, i18n } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const userId = useAuthStore((s) => s.session?.userId ?? '');
  const threads = useSupportStore((s) => s.threads[userId]) ?? NO_THREADS;
  const add = useSupportStore((s) => s.add);
  const [urgency, setUrgency] = useState<SupportUrgency>('today');
  const [channel, setChannel] = useState<SupportChannel>('message');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<SupportSuggestion[]>([]);
  // Reloj para "en camino" vs "entregada" (deliver_at), sin leer la hora durante el render.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const send = async () => {
    if (!content.trim()) return;
    setSending(true);
    const createdAt = new Date().toISOString();
    try {
      const out = await container.requestSupport.execute({ urgency, channel, content, createdAt });
      add(userId, {
        clientUuid: out.clientUuid,
        serverId: out.status === 'sent' ? out.serverId : null,
        urgency,
        channel,
        content: content.trim(),
        createdAt,
        state: out.status,
        deliverAt: out.status === 'sent' ? out.deliverAt : null,
        suggestions: out.status === 'sent' ? out.suggestions : [],
        replies: [],
      });
      setSuggestions(out.status === 'sent' ? out.suggestions : []);
      setContent('');
      if (out.status === 'queued') void refreshPendingCount();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast({ level: 'normal', title: t('support.sentTitle'), body: t(`support.sentBody.${out.status}`) });
      // Guía §11: pull al enviar (las respuestas llegan con el retraso de la misión).
      void runSync();
    } catch {
      showToast({ level: 'caution', title: t('support.errorTitle'), body: t('support.errorBody') });
    } finally {
      setSending(false);
    }
  };

  const statusText = (th: SupportThread) => {
    if (th.state === 'local') return t('support.status.local');
    if (th.state === 'queued') return t('support.status.queued');
    if (!th.deliverAt) return t('support.status.noLink');
    return new Date(th.deliverAt).getTime() > now
      ? t('support.status.onTheWay', { time: hhmm(th.deliverAt, i18n.language) })
      : t('support.status.delivered');
  };

  return (
    <Screen>
      <FadeInView style={[styles.row, { gap: spacing.md }]}>
        <IconButton icon="arrow-back" tone="filled" accessibilityLabel={t('common.back')} onPress={() => router.back()} />
        <AppText variant="h1" style={styles.flex}>{t('support.title')}</AppText>
      </FadeInView>

      <FadeInView index={1}>
        <AppText color="textSecondary">{t('support.subtitle')}</AppText>
      </FadeInView>

      <FadeInView index={2}>
        <Card style={{ gap: spacing.lg }}>
          <View style={{ gap: spacing.sm }}>
            <AppText variant="title">{t('support.urgency')}</AppText>
            <SegmentedControl<SupportUrgency>
              value={urgency}
              onChange={setUrgency}
              options={[
                { value: 'later', label: t('support.urgencies.later') },
                { value: 'today', label: t('support.urgencies.today') },
                { value: 'now', label: t('support.urgencies.now') },
              ]}
            />
          </View>
          <View style={{ gap: spacing.sm }}>
            <AppText variant="title">{t('support.channel')}</AppText>
            <SegmentedControl<SupportChannel>
              value={channel}
              onChange={setChannel}
              options={[
                { value: 'message', label: t('support.channels.message'), icon: 'chatbubble-outline' },
                { value: 'session', label: t('support.channels.session'), icon: 'videocam-outline' },
              ]}
            />
          </View>
          <View style={{ gap: spacing.sm }}>
            <AppText variant="title">{t('support.content')}</AppText>
            <VoiceNoteInput value={content} onChangeText={setContent} placeholder={t('support.placeholder')} />
          </View>
          <Button label={t('support.send')} leftIcon="send" size="lg" fullWidth loading={sending} disabled={!content.trim() || sending} onPress={send} />
          <AppText variant="caption" color="textMuted">{t('support.privacy')}</AppText>
        </Card>
      </FadeInView>

      {/* Urgencia "ahora": sugerencias del servidor. No se avisó a nadie a bordo. */}
      {suggestions.length > 0 && (
        <FadeInView index={3} style={{ gap: spacing.sm }}>
          <AppText variant="h3">{t('support.suggestionsTitle')}</AppText>
          {suggestions.map((s) => (
            <Card key={s.code} tone="alt" style={[styles.row, { gap: spacing.md, alignItems: 'flex-start' }]}>
              <Ionicons name={s.code === 'guided_breathing' ? 'leaf-outline' : 'medkit-outline'} size={22} color={colors.textSecondary} />
              <View style={[styles.flex, { gap: 2 }]}>
                <AppText variant="title">{s.title}</AppText>
                <AppText variant="bodySmall" color="textSecondary">{s.description}</AppText>
              </View>
            </Card>
          ))}
        </FadeInView>
      )}

      {threads.length > 0 && (
        <FadeInView index={4} style={{ gap: spacing.sm }}>
          <AppText variant="h3">{t('support.history')}</AppText>
          {threads.map((th) => (
            <Card key={th.clientUuid} tone="alt" style={{ gap: spacing.sm }}>
              <View style={[styles.row, { gap: spacing.sm }]}>
                <Ionicons name={th.channel === 'session' ? 'videocam-outline' : 'chatbubble-outline'} size={18} color={colors.textSecondary} />
                <AppText variant="label" style={styles.flex}>
                  {t(`support.urgencies.${th.urgency}`)} · {new Date(th.createdAt).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })}
                </AppText>
              </View>
              <AppText variant="bodySmall">{th.content}</AppText>
              <AppText variant="caption" color="textMuted">{statusText(th)}</AppText>
              {th.replies.map((r) => (
                <View key={r.id} style={[styles.reply, { borderColor: colors.border, padding: spacing.sm, gap: 2 }]}>
                  <AppText variant="caption" color="textMuted">{t('support.replyFrom')}</AppText>
                  <AppText variant="bodySmall">{r.body}</AppText>
                </View>
              ))}
            </Card>
          ))}
        </FadeInView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  reply: { borderLeftWidth: 3, borderRadius: 4 },
});
