import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { resolveVoice, speak, stopSpeaking, type TtsVoiceInfo } from '@/core/speech/speech';
import { downloadOfflineModel, getOfflineSupport, type OfflineSupport } from '@/core/speech/speechRecognition';
import { AppText, Button, Card, IconButton, PressableScale, SegmentedControl } from '@/presentation/components/ui';
import { useVoiceDictation } from '@/presentation/hooks/useVoiceDictation';

type Rate = 'slow' | 'normal' | 'fast';
const RATES: Record<Rate, number> = { slow: 0.75, normal: 0.95, fast: 1.2 };

/** Chip de estado: offline (verde) / requiere red (naranja) / desconocido. */
function ConnectivityChip({ offline, label }: { offline: boolean | null; label: string }) {
  const { colors, radius, spacing } = useAppTheme();
  const c = offline ? colors.status.normal : colors.status.caution;
  return (
    <View style={[styles.row, { gap: spacing.xs, alignSelf: 'flex-start', backgroundColor: c.background, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs }]}>
      <Ionicons name={offline ? 'cloud-offline-outline' : 'cloud-outline'} size={14} color={c.text} />
      <AppText variant="caption" style={{ color: c.text }}>{label}</AppText>
    </View>
  );
}

/**
 * Laboratorio de voz: prueba texto→voz y voz→texto con el idioma configurado.
 * Todo lo posible corre en el dispositivo, sin conexión.
 */
export default function VoiceLabScreen() {
  const { t, i18n } = useTranslation();
  const { colors, spacing, radius, typography, hitSize } = useAppTheme();
  const lang = i18n.language === 'es' ? 'es' : 'en';

  // ---- Texto a voz ----
  const [text, setText] = useState(t('voiceLab.sample'));
  const [rate, setRate] = useState<Rate>('normal');
  const [speaking, setSpeaking] = useState(false);
  const [voice, setVoice] = useState<TtsVoiceInfo | null | undefined>(undefined);

  // ---- Voz a texto ----
  const [allowNetwork, setAllowNetwork] = useState<'offline' | 'fallback'>('fallback');
  const [support, setSupport] = useState<OfflineSupport | null>(null);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);
  const [heard, setHeard] = useState('');
  const dictation = useVoiceDictation(lang, {
    allowNetworkFallback: allowNetwork === 'fallback',
    onFinal: (final) => setHeard((prev) => (prev ? `${prev} ${final}` : final)),
  });

  // Al cambiar de idioma: texto de ejemplo, voz y soporte offline del nuevo idioma.
  useEffect(() => {
    setText(t('voiceLab.sample'));
    setVoice(undefined);
    resolveVoice(lang).then(setVoice);
    getOfflineSupport(lang).then(setSupport);
    return stopSpeaking;
  }, [lang, t]);

  const pulse = useSharedValue(0);
  useEffect(() => {
    if (dictation.listening) pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }), -1, false);
    else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
  }, [dictation.listening, pulse]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: 0.45 * (1 - pulse.value), transform: [{ scale: 1 + pulse.value * 0.5 }] }));

  const onSpeak = (value: string) => {
    setSpeaking(true);
    speak(value, lang, { rate: RATES[rate], onDone: () => setSpeaking(false) });
  };

  const onDownload = async () => {
    const res = await downloadOfflineModel(lang);
    setDownloadMsg(res ? t(`voiceLab.download.${res.status}`) : t('voiceLab.download.unsupported'));
    getOfflineSupport(lang).then(setSupport);
  };

  const sttOffline = !!support?.onDeviceSupported && support.installed !== false;
  const liveText = dictation.listening && dictation.transcript ? `${heard} ${dictation.transcript}`.trim() : heard;
  const inputStyle = [typography.body, styles.input, { color: colors.text, backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, minHeight: hitSize * 2 }];

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.huge }}>
          {/* Encabezado */}
          <View style={[styles.row, { gap: spacing.md }]}>
            <IconButton icon="arrow-back" tone="filled" accessibilityLabel={t('alert.close')} onPress={() => router.back()} />
            <View style={styles.flex}>
              <AppText variant="h2">{t('voiceLab.title')}</AppText>
              <AppText variant="caption" color="textMuted">
                {t('voiceLab.languageFrom', { language: lang === 'es' ? t('settings.spanish') : t('settings.english') })}
              </AppText>
            </View>
          </View>

          {/* ---------- TEXTO A VOZ ---------- */}
          <Card style={{ gap: spacing.md }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Ionicons name="volume-high-outline" size={22} color={colors.primaryText} />
              <AppText variant="h3" style={styles.flex}>{t('voiceLab.ttsTitle')}</AppText>
            </View>
            {voice !== undefined && (
              <ConnectivityChip
                offline={voice ? voice.offline : null}
                label={voice ? t('voiceLab.voiceOffline', { name: voice.name }) : t('voiceLab.voiceSystemDefault')}
              />
            )}
            <TextInput value={text} onChangeText={setText} multiline style={inputStyle} placeholder={t('voiceLab.ttsPlaceholder')} placeholderTextColor={colors.textMuted} />
            <SegmentedControl<Rate>
              value={rate}
              onChange={setRate}
              options={[
                { value: 'slow', label: t('voiceLab.rate.slow') },
                { value: 'normal', label: t('voiceLab.rate.normal') },
                { value: 'fast', label: t('voiceLab.rate.fast') },
              ]}
            />
            <View style={[styles.row, { gap: spacing.sm, flexWrap: 'wrap' }]}>
              <Button label={t('voiceLab.speak')} icon="play" onPress={() => onSpeak(text)} />
              {speaking && <Button label={t('voiceLab.stop')} variant="outline" icon="stop" onPress={() => { stopSpeaking(); setSpeaking(false); }} />}
            </View>
          </Card>

          {/* ---------- VOZ A TEXTO ---------- */}
          <Card style={{ gap: spacing.md }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Ionicons name="mic-outline" size={22} color={colors.primaryText} />
              <AppText variant="h3" style={styles.flex}>{t('voiceLab.sttTitle')}</AppText>
            </View>

            {!dictation.supported ? (
              <>
                <ConnectivityChip offline={null} label={t('voiceLab.sttExpoGo')} />
                <AppText variant="bodySmall" color="textSecondary">{t('voiceLab.sttExpoGoBody')}</AppText>
                <TextInput value={heard} onChangeText={setHeard} multiline style={inputStyle} placeholder={t('voice.hintKeyboard')} placeholderTextColor={colors.textMuted} />
              </>
            ) : (
              <>
                {support && (
                  <ConnectivityChip
                    offline={sttOffline}
                    label={sttOffline ? t('voiceLab.sttOffline', { locale: support.locale }) : t('voiceLab.sttNeedsModel', { locale: support.locale })}
                  />
                )}
                {support && !sttOffline && Platform.OS === 'android' && (
                  <Button label={t('voiceLab.downloadModel')} variant="outline" icon="download-outline" onPress={onDownload} />
                )}
                {downloadMsg && <AppText variant="caption" color="textSecondary">{downloadMsg}</AppText>}

                <AppText variant="label" color="textSecondary">{t('voiceLab.networkPolicy')}</AppText>
                <SegmentedControl<'offline' | 'fallback'>
                  value={allowNetwork}
                  onChange={setAllowNetwork}
                  options={[
                    { value: 'offline', label: t('voiceLab.policy.offline') },
                    { value: 'fallback', label: t('voiceLab.policy.fallback') },
                  ]}
                />

                <View style={[styles.center, { paddingVertical: spacing.md }]}>
                  <View style={styles.micWrap}>
                    {dictation.listening && (
                      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius.pill, backgroundColor: colors.primary }, ringStyle]} />
                    )}
                    <PressableScale
                      accessibilityLabel={dictation.listening ? t('voice.stop') : t('voice.start')}
                      onPress={dictation.listening ? dictation.stop : dictation.start}
                      style={[styles.mic, { borderRadius: radius.pill, backgroundColor: dictation.listening ? colors.primary : colors.surfaceTinted }]}
                    >
                      <Ionicons name={dictation.listening ? 'stop' : 'mic'} size={36} color={dictation.listening ? colors.onPrimary : colors.primaryText} />
                    </PressableScale>
                  </View>
                  <AppText variant="caption" color={dictation.error ? 'dangerText' : 'textMuted'} align="center" style={{ marginTop: spacing.sm }}>
                    {dictation.error
                      ? t(`voice.error.${dictation.error}`)
                      : dictation.listening
                        ? `${t('voice.listening')} (${dictation.mode === 'offline' ? t('voiceLab.modeOffline') : t('voiceLab.modeOnline')})`
                        : t('voice.hintMic')}
                  </AppText>
                </View>

                <View style={[styles.input, styles.transcript, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, minHeight: hitSize * 2 }]}>
                  <AppText color={liveText ? 'text' : 'textMuted'}>{liveText || t('voiceLab.transcriptEmpty')}</AppText>
                </View>
              </>
            )}

            <View style={[styles.row, { gap: spacing.sm, flexWrap: 'wrap' }]}>
              <Button label={t('voiceLab.readBack')} icon="volume-high-outline" onPress={() => onSpeak(heard)} />
              <Button label={t('voiceLab.clear')} variant="ghost" onPress={() => { setHeard(''); dictation.reset(); }} />
            </View>
          </Card>

          <AppText variant="caption" color="textMuted">{t('voiceLab.footer')}</AppText>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center' },
  input: { borderWidth: 1, textAlignVertical: 'top' },
  transcript: { justifyContent: 'flex-start' },
  micWrap: { width: 80, height: 80 },
  mic: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
});
