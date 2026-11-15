import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import type { Instrument, InstrumentCode } from '@/domain/entities/Wellbeing';
import { container } from '@/di/container';
import { AppText, Button, Card, FadeInView, IconButton, PressableScale, Screen } from '@/presentation/components/ui';
import { showToast } from '@/presentation/store/toastStore';

type Answers = Record<InstrumentCode, [number | null, number | null]>;

/**
 * PHQ-2 y GAD-2 (guía §11) cuando el check-in devuelve `screening_due`. Texto oficial del servidor
 * (GET /wellbeing/instruments). POST /wellbeing/screenings → solo un mensaje neutro: el puntaje NUNCA se muestra.
 */
export default function ScreeningScreen() {
  const { t, i18n } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const lang = i18n.language === 'es' ? 'es' : 'en';
  const [instruments, setInstruments] = useState<Instrument[] | null>(null);
  const [answers, setAnswers] = useState<Answers>({ PHQ2: [null, null], GAD2: [null, null] });
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    container.getInstruments
      .execute(lang)
      .then((list) => alive && setInstruments(list))
      .catch(() => alive && setInstruments([]));
    return () => {
      alive = false;
    };
  }, [lang]);

  const ready = !!instruments?.length && instruments.every((i) => answers[i.code].every((a) => a !== null));

  const submit = async () => {
    if (!instruments) return;
    setSending(true);
    try {
      const out: string[] = [];
      for (const ins of instruments) {
        const [a, b] = answers[ins.code];
        const res = await container.submitScreening.execute({ instrument: ins.code, measuredAt: new Date().toISOString(), item1: a!, item2: b! });
        out.push(res.status === 'sent' ? res.message : t('screening.queued'));
      }
      setMessages([...new Set(out)]);
    } catch {
      showToast({ level: 'caution', title: t('screening.errorTitle'), body: t('screening.errorBody') });
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen>
      <FadeInView style={[styles.row, { gap: spacing.md }]}>
        <IconButton icon="arrow-back" tone="filled" accessibilityLabel={t('common.back')} onPress={() => router.back()} />
        <AppText variant="h1" style={styles.flex}>{t('screening.title')}</AppText>
      </FadeInView>
      <AppText color="textSecondary">{t('screening.subtitle')}</AppText>

      {instruments === null && <ActivityIndicator color={colors.primary} />}
      {instruments?.length === 0 && (
        <Card tone="alt">
          <AppText color="textSecondary">{t('screening.unavailable')}</AppText>
        </Card>
      )}

      {messages ? (
        <Card style={{ gap: spacing.md }}>
          {messages.map((m) => (
            <AppText key={m}>{m}</AppText>
          ))}
          <Button label={t('common.done')} leftIcon="checkmark" fullWidth onPress={() => router.back()} />
        </Card>
      ) : (
        instruments?.map((ins) => (
          <Card key={ins.code} style={{ gap: spacing.md }}>
            <AppText variant="title">{ins.prompt}</AppText>
            {ins.items.map((item, idx) => (
              <View key={item.code} style={{ gap: spacing.sm }}>
                <AppText>{item.text}</AppText>
                <View style={{ gap: spacing.xs }}>
                  {ins.options.map((o) => {
                    const on = answers[ins.code][idx] === o.value;
                    return (
                      <PressableScale
                        key={o.value}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        onPress={() =>
                          setAnswers((cur) => {
                            const next = [...cur[ins.code]] as [number | null, number | null];
                            next[idx] = o.value;
                            return { ...cur, [ins.code]: next };
                          })
                        }
                        style={{ padding: spacing.md, borderRadius: radius.md, borderWidth: 1, backgroundColor: on ? colors.night : colors.surfaceAlt, borderColor: on ? colors.night : colors.border }}
                      >
                        <AppText variant="label" style={{ color: on ? colors.onNight : colors.text }}>{o.label}</AppText>
                      </PressableScale>
                    );
                  })}
                </View>
              </View>
            ))}
            <AppText variant="caption" color="textMuted">{ins.note ?? ins.license}</AppText>
          </Card>
        ))
      )}

      {!messages && !!instruments?.length && (
        <Button label={t('screening.submit')} leftIcon="checkmark-done" size="lg" fullWidth loading={sending} disabled={!ready || sending} onPress={submit} />
      )}
      <AppText variant="caption" color="textMuted">{t('screening.privacy')}</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
