import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { speak } from '@/core/speech/speech';
import type { TriageEngineResult } from '@/core/engine/triage';
import type { AnswerSource, LocalAnswer, LocalAssessment, StoredProtocol, TriageCategory } from '@/domain/entities/Triage';
import { buildAnswer, evaluateLocal, questionByCode, withCallSign } from '@/domain/usecases/triageLocal';
import { newUuid } from '@/domain/usecases/uuid';
import { container } from '@/di/container';
import { AppText, Button, Card, IconButton, PressableScale, Screen, TextField } from '@/presentation/components/ui';
import { choiceLabel, noteFor, promptFor } from '@/presentation/features/triage/triageLexicon';
import { CategoryChip, DeliveryLine, deliveryText, useMicPermission, useTriageHeartbeat, useTriageSession } from '@/presentation/features/triage/triageUi';
import { useTriageVoice, type RawAnswer, type VoiceQuestion } from '@/presentation/features/triage/useTriageVoice';
import { showToast } from '@/presentation/store/toastStore';
import { useSyncStore } from '@/presentation/store/syncStore';
import { refreshPendingCount, runSync } from '@/presentation/sync/syncEngine';

type Lang = 'es' | 'en';

/**
 * Evaluación de un tripulante (guía §10): una pregunta a la vez, la `pending` del evaluador local
 * (src/core/engine/triage.js, el mismo del servidor) con el protocolo guardado. Sin preguntas propias.
 * Al terminar: clasificación local en pantalla → POST assessments → PUT answers → POST complete con
 * device_result (o todo a la cola sin enlace). El resultado del servidor manda cuando llega.
 */
export default function AssessScreen() {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'es' ? 'es' : 'en';
  const { colors, spacing, radius } = useAppTheme();
  const { sessionId, astronautId, fresh } = useLocalSearchParams<{ sessionId: string; astronautId: string; fresh?: string }>();
  const { view, reload } = useTriageSession(sessionId);
  const syncVersion = useSyncStore((s) => s.version);
  const permission = useMicPermission();
  useTriageHeartbeat(view);

  const [protocol, setProtocol] = useState<StoredProtocol | null>(null);
  const [assessment, setAssessment] = useState<LocalAssessment | null>(null);
  const [answers, setAnswers] = useState<LocalAnswer[]>([]);
  const [completing, setCompleting] = useState(false);
  const [multi, setMulti] = useState<string[]>([]);
  const [numberText, setNumberText] = useState('');
  const started = useRef(false);

  const member = view?.roster.find((m) => m.astronautId === astronautId) ?? null;
  const callSign = member?.callSign ?? assessment?.callSign ?? '';

  // Inicia (o retoma) la evaluación: "Reevaluar" (fresh) siempre crea una nueva.
  useEffect(() => {
    if (!view || !member || started.current) return;
    started.current = true;
    void (async () => {
      const draft = view.current[member.astronautId];
      let a: LocalAssessment | null =
        !fresh && draft?.status === 'in_progress' && draft.local && !draft.local.completedAt ? draft.local : null;
      const p = await container.getTriageProtocol.execute(a?.protocolVersion ?? view.session.protocolVersion);
      a ??= await container.startAssessment.execute(view.session.ref, member, p.version);
      setProtocol(p);
      setAssessment(a);
      setAnswers(a.answers);
    })();
  }, [view, member, fresh]);

  // Un envío en cola que el servidor ya respondió (sync) actualiza el resultado en pantalla.
  const assessmentId = assessment?.clientUuid;
  useEffect(() => {
    if (!assessmentId) return;
    void container.getAssessment.execute(assessmentId).then((a) => a && setAssessment(a));
  }, [assessmentId, syncVersion]);

  const result = useMemo<TriageEngineResult | { status: 'error' } | null>(() => {
    if (!protocol || !view) return null;
    try {
      return evaluateLocal(protocol.definition, view.session, answers);
    } catch {
      return { status: 'error' };
    }
  }, [protocol, view, answers]);

  const done = !!assessment?.completedAt;
  const pendingQ = result?.status === 'incomplete' && protocol && !done ? (questionByCode(protocol.definition, result.pending) ?? null) : null;
  // Preguntas de esta evaluación ya contestadas (responder_safe es de la sesión: no cuenta).
  const answeredCount =
    result && 'path' in result && protocol
      ? result.path.filter((p) => p.includes('=') && questionByCode(protocol.definition, p.split('=')[0]!)?.scope !== 'session').length
      : 0;

  const finish = useCallback(
    async (a: LocalAssessment) => {
      setCompleting(true);
      try {
        const out = await container.completeAssessment.execute(a.clientUuid);
        setAssessment(out);
        if (out.delivery === 'queued') {
          void refreshPendingCount();
          void runSync();
        }
        const cat = out.server?.triageCategory ?? out.device?.triage_category;
        Haptics.notificationAsync(cat === 'red' || cat === 'black' ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (cat) speak(`${t('triage.result.title')}: ${t(`triage.category.${cat}`)}`, lang, { chime: false });
        void reload();
      } catch {
        showToast({ level: 'caution', title: t('triage.title'), body: t('triage.assess.protocolError') });
      } finally {
        setCompleting(false);
      }
    },
    [lang, reload, t],
  );

  /** Registra una respuesta (toque o voz confirmada) y, si el protocolo terminó, completa y envía. */
  const submit = useCallback(
    async (raw: RawAnswer, source: AnswerSource) => {
      if (!pendingQ || !assessment || !protocol || !view) return;
      const answer = buildAnswer(pendingQ, raw);
      if (!answer) {
        showToast({ level: 'caution', title: t('triage.title'), body: t('triage.assess.noneExclusive') });
        return;
      }
      const entry: LocalAnswer = { clientUuid: newUuid(), questionCode: pendingQ.code, answer, source, answeredAt: new Date().toISOString() };
      setMulti([]);
      setNumberText('');
      Haptics.selectionAsync().catch(() => {});
      if (pendingQ.scope === 'session') {
        // responder_safe es de la sesión: vale para todas las evaluaciones de este dispositivo.
        await container.answerResponderSafe.execute(view.session.ref, entry);
        await reload();
        return;
      }
      const next = [...answers.filter((x) => x.questionCode !== pendingQ.code), entry];
      setAnswers(next);
      const saved = await container.saveAnswers.execute(assessment.clientUuid, next);
      try {
        if (evaluateLocal(protocol.definition, view.session, next).status === 'completed' && saved) await finish(saved);
      } catch {
        // el error del protocolo se muestra en pantalla (result.status === 'error')
      }
    },
    [answers, assessment, finish, pendingQ, protocol, reload, t, view],
  );

  /** "Atrás": quita la última respuesta del recorrido y vuelve a esa pregunta. */
  const back = useCallback(async () => {
    if (!assessment || !result || !('path' in result) || done) return;
    const codes = result.path.filter((p) => p.includes('=')).map((p) => p.split('=')[0]!);
    const last = [...codes].reverse().find((c) => answers.some((x) => x.questionCode === c));
    if (!last) return;
    const next = answers.filter((x) => x.questionCode !== last);
    setAnswers(next);
    await container.saveAnswers.execute(assessment.clientUuid, next);
  }, [answers, assessment, done, result]);

  const safeAnswerId = view?.session.responderSafeAnswer?.clientUuid ?? '';
  const voiceQuestion = useMemo<VoiceQuestion | null>(
    () =>
      pendingQ && protocol && assessment
        ? {
            key: `${assessment.clientUuid}:${pendingQ.code}:${answers.length}:${safeAnswerId}`,
            question: pendingQ,
            text: withCallSign(promptFor(pendingQ, protocol.definition, lang), callSign),
          }
        : null,
    [answers.length, assessment, callSign, lang, pendingQ, protocol, safeAnswerId],
  );

  const voice = useTriageVoice({
    current: voiceQuestion,
    permission,
    onAnswer: (raw) => void submit(raw, 'voice'),
    onBack: () => void back(),
  });

  const tap = (raw: RawAnswer) => {
    voice.cancel();
    void submit(raw, 'tap');
  };

  const exit = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/triage/[sessionId]', params: { sessionId: sessionId ?? '' } }));

  if (!view || !protocol || !assessment) {
    return (
      <Screen>
        <TopBar title={t('triage.assess.title', { callSign })} onExit={exit} exitLabel={t('triage.assess.exit')} />
        <ActivityIndicator color={colors.primary} />
        <AppText color="textMuted">{t('triage.assess.loading')}</AppText>
      </Screen>
    );
  }

  const note = pendingQ ? noteFor(pendingQ, protocol.definition, lang) : null;
  const nextMember = view.roster.find((m) => m.astronautId !== astronautId && view.current[m.astronautId]?.status !== 'completed');

  return (
    <Screen>
      <TopBar title={t('triage.assess.title', { callSign })} onExit={exit} exitLabel={t('triage.assess.exit')} />

      {/* Pregunta pendiente del evaluador */}
      {pendingQ && (
        <>
          <Card style={{ gap: spacing.md }}>
            <AppText variant="caption" color="textMuted">{t('triage.assess.step', { n: answeredCount + 1 })}</AppText>
            <AppText variant="h2">{voiceQuestion?.text}</AppText>
            {pendingQ.observable && <AppText variant="caption" color="textSecondary">{t('triage.assess.observable')}</AppText>}
            {note && <AppText variant="caption" color="textMuted">{`${t('triage.assess.note')}: ${note}`}</AppText>}
          </Card>

          <VoicePanel voice={voice} />

          {voice.pending && (
            <Card style={{ gap: spacing.md, borderColor: colors.primary, borderWidth: 2 }}>
              <AppText variant="title">{t('triage.voice.understood', { answer: voice.pending.label })}</AppText>
              <View style={[styles.row, { gap: spacing.md }]}>
                <View style={styles.flex}><Button label={t('triage.voice.confirmYes')} leftIcon="checkmark" fullWidth onPress={() => voice.confirmTap(true)} /></View>
                <View style={styles.flex}><Button label={t('triage.voice.confirmNo')} variant="outline" fullWidth onPress={() => voice.confirmTap(false)} /></View>
              </View>
            </Card>
          )}

          {/* Botones: SIEMPRE visibles (la voz es una ayuda, nunca la única vía). */}
          <View style={{ gap: spacing.md }}>
            {pendingQ.type === 'boolean' && (
              <View style={[styles.row, { gap: spacing.md }]}>
                <View style={styles.flex}><Button label={t('triage.assess.yes')} size="xl" fullWidth onPress={() => tap(true)} /></View>
                <View style={styles.flex}><Button label={t('triage.assess.no')} size="xl" variant="dark" fullWidth onPress={() => tap(false)} /></View>
              </View>
            )}
            {pendingQ.type === 'choice' &&
              (pendingQ.choices ?? []).map((c) => <Button key={c} label={choiceLabel(c, lang)} size="lg" variant="secondary" fullWidth onPress={() => tap(c)} />)}
            {pendingQ.type === 'multi_choice' && (
              <>
                <View style={[styles.wrap, { gap: spacing.sm }]}>
                  {(pendingQ.choices ?? []).map((c) => {
                    const on = multi.includes(c);
                    return (
                      <PressableScale
                        key={c}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        onPress={() => setMulti((m) => (c === 'none' ? (on ? [] : ['none']) : on ? m.filter((x) => x !== c) : [...m.filter((x) => x !== 'none'), c]))}
                        style={[styles.toggle, { borderRadius: radius.pill, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.status.normal.background : colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }]}
                      >
                        <Ionicons name={on ? 'checkbox' : 'square-outline'} size={18} color={on ? colors.primary : colors.textMuted} />
                        <AppText variant="label">{choiceLabel(c, lang)}</AppText>
                      </PressableScale>
                    );
                  })}
                </View>
                <Button label={t('triage.assess.done')} size="lg" fullWidth disabled={!multi.length} onPress={() => tap(multi)} />
              </>
            )}
            {pendingQ.type === 'number' && (
              <View style={{ gap: spacing.sm }}>
                <TextField label={t('triage.assess.numberPlaceholder')} value={numberText} onChangeText={setNumberText} keyboardType="decimal-pad" placeholder={t('triage.assess.numberPlaceholder')} />
                <Button
                  label={t('triage.assess.done')}
                  size="lg"
                  fullWidth
                  disabled={!Number.isFinite(Number(numberText.replace(',', '.'))) || !numberText.trim()}
                  onPress={() => tap(Number(numberText.replace(',', '.')))}
                />
              </View>
            )}
          </View>

          <View style={[styles.row, { gap: spacing.md }]}>
            <Button label={t('triage.assess.back')} variant="ghost" leftIcon="arrow-undo" disabled={!answers.length} onPress={() => void back()} />
          </View>
        </>
      )}

      {/* responder_safe = false → el protocolo se detiene */}
      {result?.status === 'stopped' && (
        <Card style={{ gap: spacing.md, backgroundColor: colors.status.critical.background, borderColor: colors.status.critical.ring }}>
          <AppText variant="h2">{t('triage.assess.stoppedTitle')}</AppText>
          <AppText color="textSecondary">{t('triage.assess.stoppedBody')}</AppText>
          <Button
            label={t('triage.safety.nowSafe')}
            size="lg"
            fullWidth
            onPress={() =>
              void container.answerResponderSafe
                .execute(view.session.ref, { clientUuid: newUuid(), questionCode: 'responder_safe', answer: { value: true }, source: 'tap', answeredAt: new Date().toISOString() })
                .then(reload)
            }
          />
        </Card>
      )}

      {result?.status === 'error' && (
        <Card tone="alt">
          <AppText color="dangerText">{t('triage.assess.protocolError')}</AppText>
        </Card>
      )}

      {completing && (
        <View style={[styles.row, { gap: spacing.sm }]}>
          <ActivityIndicator color={colors.primary} />
          <AppText color="textMuted">{t('triage.assess.classifying')}</AppText>
        </View>
      )}

      {/* Resultado: el del servidor manda; mientras tanto, el de la tableta marcado "pendiente de confirmar". */}
      {done && <ResultCard assessment={assessment} onRetry={() => void finish(assessment)} />}

      {done && (
        <View style={{ gap: spacing.sm }}>
          {nextMember && (
            <Button
              label={t('triage.result.next', { callSign: nextMember.callSign })}
              leftIcon="arrow-forward"
              size="lg"
              fullWidth
              onPress={() => router.replace({ pathname: '/triage/[sessionId]/assess/[astronautId]', params: { sessionId: view.session.ref, astronautId: nextMember.astronautId } })}
            />
          )}
          <Button label={t('triage.result.backToSession')} variant="outline" fullWidth onPress={exit} />
          <Button
            label={t('triage.result.reassess')}
            variant="ghost"
            leftIcon="refresh"
            fullWidth
            onPress={() => router.replace({ pathname: '/triage/[sessionId]/assess/[astronautId]', params: { sessionId: view.session.ref, astronautId, fresh: '1' } })}
          />
        </View>
      )}

      <AppText variant="caption" color="textMuted">{protocol.definition.disclaimer ?? t('triage.disclaimer')}</AppText>
    </Screen>
  );
}

function ResultCard({ assessment, onRetry }: { assessment: LocalAssessment; onRetry: () => void }) {
  const { t, i18n } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const server = assessment.server?.status === 'completed' ? assessment.server : null;
  const category: TriageCategory | null = server ? server.triageCategory : (assessment.device?.triage_category ?? null);
  const flag = server ? server.radiationFlag : (assessment.device?.radiation_flag ?? null);
  const provenance = server
    ? t('triage.result.server')
    : assessment.delivery === 'local'
      ? t('triage.result.local')
      : `${t('triage.result.device')} · ${t('triage.result.pending')}`;
  const deviceLabel = assessment.device?.triage_category
    ? `${t(`triage.category.${assessment.device.triage_category}`)}${assessment.device.radiation_flag && assessment.device.radiation_flag !== 'none' ? ` · ${t(`triage.flag.${assessment.device.radiation_flag}`)}` : ''}`
    : '';

  return (
    <Card style={{ gap: spacing.md }}>
      <AppText variant="caption" color="textMuted">{t('triage.result.title')}</AppText>
      <CategoryChip t={t} category={category} flag={flag} size="lg" />
      <View style={[styles.row, { gap: 6 }]}>
        <Ionicons name={server ? 'cloud-done-outline' : 'phone-portrait-outline'} size={16} color={colors.textMuted} />
        <AppText variant="caption" color="textMuted" style={styles.flex}>{provenance}</AppText>
      </View>

      {server?.matchesDevice === false && (
        <View style={{ gap: 4, padding: spacing.md, borderRadius: 12, backgroundColor: colors.status.caution.background }}>
          <AppText variant="label" style={{ color: colors.status.caution.text }}>{t('triage.result.mismatch')}</AppText>
          {deviceLabel ? <AppText variant="caption" color="textSecondary">{t('triage.result.deviceWas', { value: deviceLabel })}</AppText> : null}
          {server.mismatchFields.length > 0 && <AppText variant="caption" color="textMuted">{t('triage.result.mismatchFields', { fields: server.mismatchFields.join(', ') })}</AppText>}
        </View>
      )}

      {assessment.delivery === 'queued' && !server && <DeliveryLine pending text={t('triage.result.queued')} />}
      {assessment.error && (
        <View style={{ gap: spacing.sm }}>
          <AppText variant="bodySmall" color="dangerText">{t('triage.result.sendError', { code: assessment.error })}</AppText>
          <Button label={t('triage.result.retry')} variant="outline" size="sm" leftIcon="refresh" onPress={onRetry} />
        </View>
      )}

      {/* Avisos: a bordo inmediato; a Tierra con su hora de llegada (deliver_at) o sin enlace. */}
      {server && server.escalations.length > 0 && (
        <View style={{ gap: 4 }}>
          <AppText variant="label">{t('triage.result.notices')}</AppText>
          {server.escalations.map((e, i) => (
            <View key={`${e.level}-${i}`} style={{ gap: 2 }}>
              <AppText variant="bodySmall">{t(`triage.result.level.${e.level}` as 'triage.result.level.crew', { defaultValue: e.level })}</AppText>
              <DeliveryLine
                pending={e.level === 'flight_surgeon' && !e.deliverAt}
                text={e.level === 'flight_surgeon' ? deliveryText(t, i18n.language, e.deliverAt) : t('triage.delivery.onboard')}
              />
            </View>
          ))}
        </View>
      )}
      {!server && assessment.delivery === 'queued' && (
        <DeliveryLine pending text={`${t('triage.result.level.flight_surgeon')}: ${t('triage.delivery.noLink')}`} />
      )}
    </Card>
  );
}

function VoicePanel({ voice }: { voice: ReturnType<typeof useTriageVoice> }) {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const status =
    voice.phase === 'speaking'
      ? t('triage.voice.speaking')
      : voice.phase === 'listening'
        ? t('triage.voice.listening')
        : voice.phase === 'buttons'
          ? t('triage.voice.buttonsMode')
          : voice.mode === 'system'
            ? t('triage.voice.systemDictation')
            : t('triage.voice.commands');
  const hint =
    voice.mode === 'none'
      ? t('triage.voice.unavailable')
      : !voice.canListen
        ? t('triage.voice.permissionDenied')
        : voice.mode === 'native' && voice.offlineModel === false
          ? t('triage.voice.noOfflineModel')
          : null;
  const listening = voice.phase === 'listening';
  return (
    <Card tone="alt" style={{ gap: spacing.sm, padding: spacing.lg }}>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Ionicons name={listening ? 'mic' : voice.phase === 'speaking' ? 'volume-high' : 'mic-outline'} size={20} color={listening ? colors.status.critical.solid : colors.textMuted} />
        <AppText variant="bodySmall" color="textSecondary" style={styles.flex}>{voice.message ?? status}</AppText>
      </View>
      {voice.heard && <AppText variant="caption" color="textMuted">{t('triage.voice.heard', { text: voice.heard })}</AppText>}
      {hint && <AppText variant="caption" color="textMuted">{hint}</AppText>}
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Button label={t('triage.assess.repeat')} variant="outline" size="sm" leftIcon="volume-high-outline" onPress={voice.repeat} />
        {voice.canListen && (
          <Button
            label={listening ? t('triage.voice.buttonsOnly') : t('triage.voice.mic')}
            variant={listening ? 'outline' : 'secondary'}
            size="sm"
            leftIcon={listening ? 'hand-left-outline' : 'mic'}
            onPress={voice.toggleVoice}
          />
        )}
      </View>
    </Card>
  );
}

function TopBar({ title, onExit, exitLabel }: { title: string; onExit: () => void; exitLabel: string }) {
  const { spacing } = useAppTheme();
  return (
    <View style={[styles.row, { gap: spacing.md }]}>
      <AppText variant="h1" style={styles.flex}>{title}</AppText>
      <IconButton icon="close" tone="filled" accessibilityLabel={exitLabel} onPress={onExit} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1 },
});
