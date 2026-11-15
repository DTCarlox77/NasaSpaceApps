import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { palette, useAppTheme } from '@/core/theme';
import { speak } from '@/core/speech/speech';
import { canCloseEmergency } from '@/domain/entities/Session';
import type { AttentionRow, StoredProtocol, TriageRosterEntry } from '@/domain/entities/Triage';
import { questionByCode } from '@/domain/usecases/triageLocal';
import { newUuid } from '@/domain/usecases/uuid';
import { container } from '@/di/container';
import { AppText, Button, Card, FadeInView, HoldToConfirmButton, IconButton, Screen, VoiceNoteInput } from '@/presentation/components/ui';
import { Disclaimer } from '@/presentation/components/feedback/Disclaimer';
import { promptFor } from '@/presentation/features/triage/triageLexicon';
import {
  CategoryChip,
  DeliveryLine,
  deliveryText,
  useMicPermission,
  useTriageHeartbeat,
  useTriageSession,
} from '@/presentation/features/triage/triageUi';
import { useAuthStore } from '@/presentation/store/authStore';
import { showToast } from '@/presentation/store/toastStore';
import { refreshPendingCount, runSync } from '@/presentation/sync/syncEngine';

/**
 * Sesión de triaje (guía §10):
 * - Estado de la sesión; `responder_safe` primero ("Ponte a salvo" si es false).
 * - A quién evaluar: roster del servidor o, sin conexión, la tripulación vigente guardada.
 * - Orden de atención con su motivo (`attention_order` del servidor; sin enlace, calculado con el protocolo).
 * - "Pregunta a Tierra" (texto o dictado) y "Cerrar" (solo comandante u oficial médico).
 * - Latido cada ~30 s mientras esta pantalla está abierta y la sesión activa.
 */
export default function TriageSessionScreen() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'es' ? 'es' : 'en';
  const { colors, spacing } = useAppTheme();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const me = useAuthStore((s) => s.session);
  const { view, loading, reload } = useTriageSession(sessionId);
  const [protocol, setProtocol] = useState<StoredProtocol | null>(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [closing, setClosing] = useState(false);
  useMicPermission(); // se pide al entrar al triaje; si lo niegan, todo funciona con botones
  useTriageHeartbeat(view);

  const protocolVersion = view?.session.protocolVersion ?? null;
  useEffect(() => {
    let alive = true;
    void container.getTriageProtocol.execute(protocolVersion).then((p) => alive && setProtocol(p));
    return () => {
      alive = false;
    };
  }, [protocolVersion]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const time = (iso: string) => new Date(iso).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });

  if (!view) {
    return (
      <Screen>
        <Header title={t('triage.title')} onClose={close} closeLabel={t('common.back')} />
        {loading ? <ActivityIndicator color={colors.primary} /> : <AppText color="textSecondary">{t('triage.notFound')}</AppText>}
      </Screen>
    );
  }

  const s = view.session;
  const closed = s.status === 'closed' || s.status === 'cancelled';
  const safe = view.nextStep === 'start_assessments';
  const canClose = !closed && (s.demo || canCloseEmergency(me));
  const safetyQuestion = protocol ? questionByCode(protocol.definition, 'responder_safe') : undefined;

  const answerSafe = async (value: boolean) => {
    await container.answerResponderSafe.execute(s.ref, {
      clientUuid: newUuid(),
      questionCode: 'responder_safe',
      answer: { value },
      source: 'tap',
      answeredAt: new Date().toISOString(),
    });
    void reload();
  };

  const assess = (m: TriageRosterEntry, fresh: boolean) =>
    router.push({ pathname: '/triage/[sessionId]/assess/[astronautId]', params: { sessionId: s.ref, astronautId: m.astronautId, ...(fresh ? { fresh: '1' } : {}) } });

  const ask = async () => {
    const body = question.trim();
    if (!body) return showToast({ level: 'caution', title: t('triage.earth.title'), body: t('triage.earth.empty') });
    setAsking(true);
    try {
      const q = await container.askEarth.execute(s.ref, body);
      setQuestion('');
      if (q.delivery === 'queued') {
        void refreshPendingCount();
        void runSync();
      }
      void reload();
    } catch {
      showToast({ level: 'caution', title: t('triage.earth.title'), body: t('triage.earth.error') });
    } finally {
      setAsking(false);
    }
  };

  const closeSession = async (status: 'closed' | 'cancelled') => {
    setClosing(true);
    try {
      const res = await container.closeTriageSession.execute(view, status, status === 'cancelled' ? t('triage.close.note') : undefined);
      if (res === 'forbidden') showToast({ level: 'caution', title: t('triage.close.title'), body: t('triage.close.forbidden') });
      else {
        showToast({ level: 'info', title: t('triage.close.title'), body: t(res === 'queued' ? 'triage.close.queued' : 'triage.close.done') });
        speak(t('triage.close.done'), lang);
      }
      void reload();
    } catch {
      showToast({ level: 'caution', title: t('triage.close.title'), body: t('triage.close.error') });
    } finally {
      setClosing(false);
    }
  };

  return (
    <Screen>
      <Header title={t('triage.title')} onClose={close} closeLabel={t('common.back')} />

      {/* Estado de la sesión */}
      <FadeInView index={1}>
        <Card style={{ gap: spacing.sm }}>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Ionicons name={closed ? 'checkmark-done-circle' : 'pulse'} size={22} color={closed ? colors.textMuted : colors.status.critical.solid} />
            <AppText variant="title" style={styles.flex}>{t(`triage.status.${s.status}`)}</AppText>
            <IconButton icon="refresh" accessibilityLabel={t('triage.refresh')} onPress={() => void reload()} />
          </View>
          <InfoRow label={t('triage.startedAt')} value={time(s.startedAt)} />
          {s.missionCode && <InfoRow label="" value={s.missionCode} />}
          {protocol && (
            <InfoRow
              label={t('triage.protocol')}
              value={t(protocol.origin === 'fallback' ? 'triage.protocolFallback' : 'triage.protocolVersion', { version: protocol.version })}
            />
          )}
          {!view.fromServer && !s.demo && <Note icon="cloud-offline-outline" text={t('triage.offline')} />}
          {s.joined && <Note icon="people-outline" text={t('triage.joined')} />}
          {s.context.solar_event_active === true && <Note icon="sunny-outline" text={t('triage.solarEvent')} />}
          {!closed && !s.demo && <Note icon="heart-outline" text={t('triage.heartbeat')} />}
        </Card>
      </FadeInView>

      {closed && (
        <Card tone="alt">
          <AppText color="textSecondary">{t('triage.closedSession')}</AppText>
        </Card>
      )}

      {/* responder_safe primero */}
      {!closed && view.nextStep === 'secure_self' && (
        <Card style={{ gap: spacing.md, backgroundColor: colors.status.critical.background, borderColor: colors.status.critical.ring }}>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Ionicons name="shield-half" size={26} color={colors.status.critical.solid} />
            <AppText variant="h2" style={styles.flex}>{t('triage.safety.secureSelfTitle')}</AppText>
          </View>
          {safetyQuestion && <AppText>{promptFor(safetyQuestion, protocol!.definition, lang)}</AppText>}
          <AppText color="textSecondary">{t('triage.safety.secureSelfBody')}</AppText>
          <Button label={t('triage.safety.nowSafe')} leftIcon="checkmark" size="lg" fullWidth onPress={() => void answerSafe(true)} />
        </Card>
      )}
      {!closed && view.nextStep === null && safetyQuestion && (
        <Card style={{ gap: spacing.md }}>
          <AppText variant="title">{t('triage.safety.title')}</AppText>
          <AppText>{promptFor(safetyQuestion, protocol!.definition, lang)}</AppText>
          <View style={[styles.row, { gap: spacing.md }]}>
            <View style={styles.flex}><Button label={t('triage.assess.yes')} size="lg" fullWidth onPress={() => void answerSafe(true)} /></View>
            <View style={styles.flex}><Button label={t('triage.assess.no')} variant="danger" size="lg" fullWidth onPress={() => void answerSafe(false)} /></View>
          </View>
        </Card>
      )}

      {/* A quién evaluar */}
      <FadeInView index={2} style={{ gap: spacing.sm }}>
        <AppText variant="title">{t('triage.roster.title')}</AppText>
        <AppText variant="caption" color="textMuted">{t(`triage.roster.${view.rosterSource}`)}</AppText>
        {view.roster.length === 0 && <AppText color="textSecondary">{t('triage.roster.empty')}</AppText>}
        {!safe && !closed && view.roster.length > 0 && <AppText variant="caption" color="dangerText">{t('triage.roster.needSafe')}</AppText>}
        {view.roster.map((m) => {
          const c = view.current[m.astronautId];
          return (
            <Card key={m.astronautId} style={{ gap: spacing.sm, padding: spacing.lg }}>
              <View style={[styles.row, { gap: spacing.sm }]}>
                <View style={styles.flex}>
                  <AppText variant="title">{m.callSign}</AppText>
                  {m.crewRole && <AppText variant="caption" color="textMuted">{t(`crewRoles.${m.crewRole}` as 'crewRoles.commander', { defaultValue: m.crewRole })}</AppText>}
                </View>
                <CategoryChip
                  t={t}
                  category={c?.status === 'completed' ? c.triageCategory : null}
                  flag={c?.status === 'completed' ? c.radiationFlag : null}
                  fallback={c?.status === 'in_progress' ? t('triage.attention.inProgress') : undefined}
                />
              </View>
              {m.priorityReason && <AppText variant="caption" color="textSecondary">{m.priorityReason}</AppText>}
              {c?.status === 'completed' && c.computedBy === 'device' && <Note icon="time-outline" text={t('triage.result.pending')} />}
              {c?.matchesDevice === false && <Note icon="warning-outline" text={t('triage.result.mismatch')} />}
              {!closed && (
                <View style={[styles.row, { gap: spacing.sm }]}>
                  {c?.status === 'completed' ? (
                    <Button label={t('triage.roster.reassess')} variant="outline" size="sm" leftIcon="refresh" disabled={!safe} onPress={() => assess(m, true)} />
                  ) : (
                    <Button
                      label={c?.status === 'in_progress' && c.local ? t('triage.roster.resume') : t('triage.roster.assess')}
                      size="sm"
                      leftIcon="medkit-outline"
                      disabled={!safe}
                      onPress={() => assess(m, false)}
                    />
                  )}
                </View>
              )}
            </Card>
          );
        })}
      </FadeInView>

      {/* Orden de atención */}
      <FadeInView index={3} style={{ gap: spacing.sm }}>
        <AppText variant="title">{t('triage.attention.title')}</AppText>
        <AppText variant="caption" color="textMuted">{t(view.attentionSource === 'server' ? 'triage.attention.server' : 'triage.attention.device')}</AppText>
        <Card style={{ gap: spacing.md }}>
          {view.attention.length === 0 && <AppText color="textSecondary">{t('triage.attention.empty')}</AppText>}
          {view.attention.map((row) => (
            <AttentionItem key={row.astronautId} row={row} />
          ))}
        </Card>
      </FadeInView>

      {/* Pregunta a Tierra */}
      <FadeInView index={4} style={{ gap: spacing.sm }}>
        <AppText variant="title">{t('triage.earth.title')}</AppText>
        <AppText variant="caption" color="textMuted">{t('triage.earth.hint')}</AppText>
        {s.demo ? (
          <AppText color="textSecondary">{t('triage.earth.demo')}</AppText>
        ) : (
          <Card style={{ gap: spacing.md }}>
            {!closed && (
              <>
                <VoiceNoteInput value={question} onChangeText={setQuestion} placeholder={t('triage.earth.placeholder')} />
                <Button label={t('triage.earth.send')} leftIcon="planet-outline" loading={asking} onPress={() => void ask()} />
              </>
            )}
            {view.questions
              .slice()
              .reverse()
              .map((q) => (
                <View key={q.clientUuid} style={{ gap: 2 }}>
                  <AppText variant="bodySmall">{q.body}</AppText>
                  <DeliveryLine pending={q.delivery === 'queued' || !q.deliverAt} text={deliveryText(t, i18n.language, q.deliverAt, q.delivery === 'queued')} />
                </View>
              ))}
          </Card>
        )}
      </FadeInView>

      {/* Cerrar: solo comandante u oficial médico */}
      {canClose && (
        <FadeInView index={5} style={{ gap: spacing.sm }}>
          <AppText variant="title">{t('triage.close.title')}</AppText>
          <AppText variant="caption" color="textMuted">{t('triage.close.hint')}</AppText>
          <View style={[styles.row, { justifyContent: 'space-around' }]}>
            <HoldToConfirmButton
              label={t('triage.close.holdClosed')}
              hint={t('triage.close.hint')}
              color={palette.green[700]}
              icon="checkmark-done"
              size={120}
              duration={2500}
              disabled={closing}
              onConfirm={() => void closeSession('closed')}
            />
            <HoldToConfirmButton
              label={t('triage.close.holdCancelled')}
              hint={t('triage.close.hint')}
              color={palette.neutral[700]}
              icon="close"
              size={120}
              duration={2500}
              disabled={closing}
              onConfirm={() => void closeSession('cancelled')}
            />
          </View>
        </FadeInView>
      )}

      <AppText variant="caption" color="textMuted">{protocol?.definition.disclaimer ?? t('triage.disclaimer')}</AppText>
      <Disclaimer />
    </Screen>
  );
}

function AttentionItem({ row }: { row: AttentionRow }) {
  const { t } = useTranslation();
  const { spacing } = useAppTheme();
  return (
    <View style={[styles.row, { gap: spacing.md, alignItems: 'flex-start' }]}>
      <AppText variant="h2" style={{ width: 28 }}>{row.position}</AppText>
      <View style={[styles.flex, { gap: 4 }]}>
        <AppText variant="title">{row.callSign}</AppText>
        <CategoryChip
          t={t}
          category={row.triageCategory}
          flag={row.radiationFlag}
          fallback={row.status === 'in_progress' ? t('triage.attention.inProgress') : undefined}
        />
        {/* El motivo en texto lo da el servidor; sin enlace solo se muestra la categoría de la tableta. */}
        {row.reason && <AppText variant="caption" color="textSecondary">{row.reason}</AppText>}
      </View>
    </View>
  );
}

function Header({ title, onClose, closeLabel }: { title: string; onClose: () => void; closeLabel: string }) {
  const { colors, spacing, radius } = useAppTheme();
  return (
    <View style={[styles.row, { gap: spacing.md }]}>
      <View style={[styles.badge, { backgroundColor: colors.status.critical.background, borderRadius: radius.pill }]}>
        <Ionicons name="medkit" size={20} color={colors.status.critical.text} />
      </View>
      <AppText variant="h1" style={styles.flex}>{title}</AppText>
      <IconButton icon="arrow-back" tone="filled" accessibilityLabel={closeLabel} onPress={onClose} />
    </View>
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

function Note({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.row, { gap: 6 }]}>
      <Ionicons name={icon} size={14} color={colors.textMuted} />
      <AppText variant="caption" color="textMuted" style={styles.flex}>{text}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  badge: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  infoValue: { flexShrink: 1, textAlign: 'right' },
});
