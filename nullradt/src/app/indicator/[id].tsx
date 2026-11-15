import { useMemo, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { speak, stopSpeaking } from '@/core/speech/speech';
import type { HealthStatus, IndicatorId } from '@/domain/entities/HealthIndicator';
import { buildHistory, nextDueAt } from '@/domain/usecases/IndicatorHistory';
import { isMeasurable } from '@/domain/usecases/SimulateMeasurement';
import { evaluateIndicator, RULES } from '@/domain/rules/ruleEngine';
import { DODDS_GRIP, sexReference } from '@/domain/rules/sexReference';
import { SexRangeCard } from '@/presentation/features/health/SexRangeCard';
import { useMyBiometrics } from '@/presentation/hooks/useMyBiometrics';
import { Disclaimer } from '@/presentation/components/feedback/Disclaimer';
import { EscalationLadder } from '@/presentation/components/health/EscalationLadder';
import { TrendChart } from '@/presentation/components/health/TrendChart';
import { BackHeader } from '@/presentation/components/navigation/BackHeader';
import { AppText, Button, Card, FadeInView, IconButton, Screen, SegmentedControl, StatusBadge } from '@/presentation/components/ui';
import { formatValue, SystemIcon, timeAgo } from '@/presentation/features/health/healthUi';
import { useHealthOverview } from '@/presentation/hooks/useHealthOverview';
import { useNow } from '@/presentation/hooks/useNow';
import { useAuthStore } from '@/presentation/store/authStore';

type Period = '7' | '30' | 'all';
type GuideTab = 'how' | 'meaning' | 'actions';

/** Detalle de un indicador: valor + semáforo, gráfica en el tiempo, escalamiento, función y guía paso a paso. */
export default function IndicatorDetailScreen() {
  const { t, i18n } = useTranslation();
  // Claves dinámicas: los indicadores nuevos del catálogo del servidor aún no tienen guía (defaultValue vacío).
  const tx = t as unknown as (key: string, opts?: Record<string, unknown>) => string;
  const { colors, spacing, radius } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: IndicatorId }>();
  const { overview, baseIndicators, localReadings, sex } = useHealthOverview();
  const me = useMyBiometrics();
  const userId = useAuthStore((s) => s.session?.userId ?? '');
  const [period, setPeriod] = useState<Period>('30');
  const [tab, setTab] = useState<GuideTab>('how');
  const [speaking, setSpeaking] = useState(false);
  const now = useNow(60_000);

  const indicator = overview?.indicators.find((i) => i.id === id);
  const base = baseIndicators.find((i) => i.id === id);
  const history = useMemo(() => (base ? buildHistory(base, localReadings, userId, 60, sex) : []), [base, localReadings, userId, sex]);
  const visible = useMemo(() => {
    if (period === 'all') return history;
    const from = now - Number(period) * 86_400_000;
    return history.filter((p) => p.at >= from);
  }, [history, period, now]);

  if (!indicator || !id) {
    return (
      <Screen>
        <BackHeader title={t('indicatorDetail.title')} fallback="/body" />
      </Screen>
    );
  }

  const rule = RULES[id];
  const last = history[history.length - 1];
  const prev = history.slice(0, -1);
  const evaluation = last
    ? evaluateIndicator(id, last.value, last.secondary, { history: prev.slice(-7).map((p) => p.value), recentStatuses: prev.slice(-3).map((p) => p.status), sex })
    : null;
  const status: HealthStatus = indicator.status;
  const due = nextDueAt(indicator, last?.at);
  const overdue = due !== null && due < now;

  const steps = ((tx(`guides.${id}.how`, { returnObjects: true, defaultValue: [] }) as unknown as string[]) ?? []);
  const sexRef = me ? sexReference(id, me.sex, me.age) : null;
  const sources = [evaluation?.source ?? rule.source, rule.source, sexRef?.source, id === 'gripStrength' ? DODDS_GRIP : undefined].filter(
    (src, i, all): src is NonNullable<typeof src> => !!src && all.findIndex((x) => x?.url === src.url) === i,
  );
  const toggleSpeak = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    const text =
      tab === 'how'
        ? steps.map((s, i) => `${i + 1}. ${s}`).join(' ')
        : tab === 'meaning'
          ? tx(`guides.${id}.meaning`, { defaultValue: '' })
          : tx(`guides.${id}.actions.${status}`, { defaultValue: '' });
    setSpeaking(true);
    speak(text, i18n.language === 'es' ? 'es' : 'en', { chime: false, onDone: () => setSpeaking(false) });
  };

  return (
    <Screen>
      <BackHeader title={t(`indicators.${id}.name`)} subtitle={t(`systems.${indicator.systemId}.name`)} fallback="/body" />

      <FadeInView index={1}>
        <Card style={{ gap: spacing.md, backgroundColor: colors.status[status].background, borderColor: colors.status[status].ring }}>
          <View style={[styles.row, { gap: spacing.md }]}>
            <View style={[styles.icon, { backgroundColor: colors.surface, borderRadius: radius.button }]}>
              <SystemIcon id={indicator.systemId} size={26} color={colors.primaryText} />
            </View>
            <View style={styles.flex}>
              <View style={[styles.row, { gap: 6, alignItems: 'baseline' }]}>
                <AppText variant="display" style={{ fontVariant: ['tabular-nums'] }}>{formatValue(indicator)}</AppText>
                <AppText color="textMuted">{indicator.unit}</AppText>
              </View>
              <AppText variant="caption" color="textMuted">
                {indicator.latest ? `${timeAgo(indicator.latest.takenAt, t)} · ${(indicator.latest.source ? t(`health.source.${indicator.latest.source}`) : t('health.source.server'))}` : t('body.noReadings')}
              </AppText>
            </View>
          </View>
          <StatusBadge status={status} size="lg" />
          {evaluation && <AppText style={{ color: colors.status[status].text }}>{t(`rules.reasons.${evaluation.reason}` as never)}</AppText>}
          {indicator.synthetic && <AppText variant="caption" color="textMuted">{t('indicatorDetail.syntheticNote')}</AppText>}
        </Card>
      </FadeInView>

      <FadeInView index={2}>
        <Card style={{ gap: spacing.md }}>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Ionicons name="analytics-outline" size={20} color={colors.primaryText} />
            <AppText variant="h3" style={styles.flex}>{t('indicatorDetail.evolution')}</AppText>
          </View>
          <SegmentedControl<Period>
            value={period}
            onChange={setPeriod}
            options={[
              { value: '7', label: t('indicatorDetail.period7') },
              { value: '30', label: t('indicatorDetail.period30') },
              { value: 'all', label: t('indicatorDetail.periodAll') },
            ]}
          />
          <TrendChart points={visible} unit={indicator.unit} bands={rule.bands} personalRange={indicator.personalRange} />
          <View style={[styles.wrap, { gap: spacing.md }]}>
            {rule.bands && <Legend color={colors.status.normal.background} border={colors.status.normal.ring} label={t('indicatorDetail.legendNormal')} />}
            {rule.bands?.caution && <Legend color={colors.status.caution.background} border={colors.status.caution.ring} label={t('indicatorDetail.legendCaution')} />}
            {indicator.personalRange && <Legend dashed color={colors.tertiary} label={t('indicatorDetail.legendPersonal')} />}
          </View>
          <AppText variant="caption" color="textMuted">{t('indicatorDetail.tapHint')}</AppText>
        </Card>
      </FadeInView>

      {evaluation && (
        <FadeInView index={3}>
          <Card style={{ gap: spacing.md }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Ionicons name="git-branch-outline" size={20} color={colors.primaryText} />
              <AppText variant="h3" style={styles.flex}>{t('rules.title')}</AppText>
            </View>
            <EscalationLadder level={evaluation.escalation} />
            {evaluation.remeasureMin && <AppText variant="bodySmall" color="textSecondary">{t('rules.remeasure', { min: evaluation.remeasureMin })}</AppText>}
            <AppText variant="caption" color="textMuted">{t(`rules.kinds.${rule.kind}`)}</AppText>
          </Card>
        </FadeInView>
      )}

      {me && (
        <FadeInView index={4}>
          <SexRangeCard id={id} unit={indicator.unit} sex={me.sex} age={me.age} />
        </FadeInView>
      )}

      <FadeInView index={4}>
        <Card style={{ gap: spacing.md }}>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Ionicons name="information-circle-outline" size={20} color={colors.primaryText} />
            <AppText variant="h3">{t('indicatorDetail.function')}</AppText>
          </View>
          <AppText>{t(`indicators.${id}.description`)}</AppText>
          <AppText variant="bodySmall" color="textSecondary">{t(`systems.${indicator.systemId}.role`)}</AppText>
          <View style={[styles.wrap, { gap: spacing.sm }]}>
            {indicator.hazards.map((h) => (
              <View key={h} style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt }}>
                <AppText variant="caption">{t(`hazards.${h}.title` as never)}</AppText>
              </View>
            ))}
          </View>
        </Card>
      </FadeInView>

      <FadeInView index={5}>
        <Card style={{ gap: spacing.md }}>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Ionicons name="list-outline" size={20} color={colors.primaryText} />
            <AppText variant="h3" style={styles.flex}>{t('indicatorDetail.guide')}</AppText>
            <IconButton icon={speaking ? 'stop-circle-outline' : 'volume-high-outline'} tone="filled" accessibilityLabel={t('indicatorDetail.readAloud')} onPress={toggleSpeak} />
          </View>
          <SegmentedControl<GuideTab>
            value={tab}
            onChange={(v) => {
              stopSpeaking();
              setSpeaking(false);
              setTab(v);
            }}
            options={[
              { value: 'how', label: t('indicatorDetail.tabHow') },
              { value: 'meaning', label: t('indicatorDetail.tabMeaning') },
              { value: 'actions', label: t('indicatorDetail.tabActions') },
            ]}
          />
          {tab === 'how' &&
            steps.map((s, i) => (
              <View key={s} style={[styles.row, { gap: spacing.md, alignItems: 'flex-start' }]}>
                <View style={[styles.num, { backgroundColor: colors.primarySoft }]}>
                  <AppText variant="label" color="primaryText">{i + 1}</AppText>
                </View>
                <AppText style={styles.flex}>{s}</AppText>
              </View>
            ))}
          {tab === 'meaning' && <AppText>{tx(`guides.${id}.meaning`, { defaultValue: '' })}</AppText>}
          {tab === 'actions' && (
            <View style={{ gap: spacing.sm }}>
              {(['normal', 'caution', 'critical', 'unevaluated'] as HealthStatus[]).map((s) => (
                <View
                  key={s}
                  style={{
                    padding: spacing.md,
                    gap: spacing.xs,
                    borderRadius: radius.md,
                    backgroundColor: colors.status[s].background,
                    borderWidth: s === status ? 2 : 1,
                    borderColor: s === status ? colors.status[s].solid : colors.status[s].ring,
                  }}
                >
                  <View style={[styles.row, { gap: spacing.sm }]}>
                    <StatusBadge status={s} size="sm" />
                    {s === status && <AppText variant="caption" style={{ color: colors.status[s].text }}>{t('indicatorDetail.current')}</AppText>}
                  </View>
                  <AppText variant="bodySmall" style={{ color: colors.status[s].text }}>{tx(`guides.${id}.actions.${s}`, { defaultValue: '' })}</AppText>
                </View>
              ))}
            </View>
          )}
        </Card>
      </FadeInView>

      <FadeInView index={6}>
        <Card tone="alt" style={[styles.row, { gap: spacing.md }]}>
          <Ionicons name={overdue ? 'alarm' : 'calendar-outline'} size={22} color={overdue ? colors.accentText : colors.primaryText} />
          <View style={styles.flex}>
            <AppText variant="title">{overdue ? t('indicatorDetail.overdue') : t('indicatorDetail.nextDue')}</AppText>
            <AppText variant="caption" color="textSecondary">
              {due ? new Date(due).toLocaleString(i18n.language, { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
              {' · '}
              {t('indicatorDetail.every', { hours: indicator.frequencyHours })}
            </AppText>
          </View>
        </Card>
      </FadeInView>

      <FadeInView index={7} style={{ gap: spacing.sm }}>
        {isMeasurable(id) && (
          <Button label={t('indicatorDetail.measureDevice')} leftIcon="bluetooth" size="lg" fullWidth onPress={() => router.push({ pathname: '/measure', params: { indicator: id } })} />
        )}
        <Button
          label={t('indicatorDetail.registerManual')}
          leftIcon="camera-outline"
          variant={isMeasurable(id) ? 'outline' : 'primary'}
          size="lg"
          fullWidth
          onPress={() => router.push({ pathname: '/register', params: { indicator: id } })}
        />
      </FadeInView>

      {/* Fuentes médicas de todo lo que se muestra en esta pantalla. */}
      <View style={{ gap: spacing.xs }}>
        <AppText variant="label" color="textSecondary">{t('sexRange.sourcesTitle')}</AppText>
        {sources.map((src, i) => (
          <AppText key={src.url} variant="caption" color="primaryText" accessibilityRole="link" onPress={() => Linking.openURL(src.url)}>
            {i + 1}. {src.title}
          </AppText>
        ))}
      </View>
      <Disclaimer />
    </Screen>
  );
}

function Legend({ color, border, label, dashed }: { color: string; border?: string; label: string; dashed?: boolean }) {
  const { spacing } = useAppTheme();
  return (
    <View style={[styles.row, { gap: spacing.xs }]}>
      <View style={dashed ? { width: 16, borderTopWidth: 2, borderStyle: 'dashed', borderColor: color } : { width: 14, height: 14, borderRadius: 4, backgroundColor: color, borderWidth: 1, borderColor: border }} />
      <AppText variant="caption" color="textSecondary">{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  icon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
});
