import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { dictateWithSystem, systemDictationAvailable } from '@/core/speech/systemDictation';
import { useVoiceDictation } from '@/presentation/hooks/useVoiceDictation';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

export interface VoiceNoteInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
}

/**
 * Campo de texto con micrófono.
 * - Development build / APK: reconocimiento propio en el idioma de la app (offline si hay modelo).
 * - Expo Go (Android): abre el dictado del sistema en el idioma de la app.
 * El chip ES/EN indica en qué idioma se escucha.
 */
export function VoiceNoteInput({ value, onChangeText, placeholder }: VoiceNoteInputProps) {
  const { t, i18n } = useTranslation();
  const { colors, radius, spacing, typography, hitSize } = useAppTheme();
  const lang = i18n.language.split('-')[0] === 'es' ? 'es' : 'en';
  const append = (finalText: string) => onChangeText(value ? `${value.trim()} ${finalText}` : finalText);
  const dictation = useVoiceDictation(lang, { onFinal: append });
  const [systemBusy, setSystemBusy] = useState(false);
  const canDictate = dictation.supported || systemDictationAvailable;
  const listening = dictation.listening || systemBusy;

  const onMic = async () => {
    if (dictation.supported) return dictation.listening ? dictation.stop() : dictation.start();
    setSystemBusy(true);
    try {
      const text = await dictateWithSystem(lang, placeholder);
      if (text) append(text);
    } catch {
      // Sin servicio de voz en el teléfono: queda el teclado.
    } finally {
      setSystemBusy(false);
    }
  };

  const pulse = useSharedValue(0);
  useEffect(() => {
    if (listening) {
      pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }), -1, false);
    } else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
  }, [listening, pulse]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: 0.5 * (1 - pulse.value), transform: [{ scale: 1 + pulse.value * 0.6 }] }));

  // Mientras escucha mostramos el texto parcial; al terminar se agrega al valor.
  const shown = dictation.listening && dictation.transcript ? `${value} ${dictation.transcript}`.trim() : value;

  return (
    <View style={{ gap: spacing.xs }}>
      <View style={[styles.box, { borderColor: dictation.listening ? colors.primary : colors.border, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, gap: spacing.sm }]}>
        <TextInput
          value={shown}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          multiline
          editable={!dictation.listening}
          style={[typography.body, styles.input, { color: colors.text, minHeight: hitSize * 1.5 }]}
          accessibilityLabel={placeholder}
        />
        {canDictate && (
          <View style={styles.micWrap}>
            {listening && (
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius.pill, backgroundColor: colors.primary }, ringStyle]} />
            )}
            <PressableScale
              accessibilityLabel={`${listening ? t('voice.stop') : t('voice.start')} (${lang.toUpperCase()})`}
              onPress={onMic}
              style={[styles.mic, { borderRadius: radius.pill, backgroundColor: listening ? colors.primary : colors.surfaceTinted }]}
            >
              <Ionicons name={listening ? 'stop' : 'mic'} size={22} color={listening ? colors.onPrimary : colors.primaryText} />
            </PressableScale>
            <View style={[styles.langChip, { backgroundColor: colors.night, borderRadius: radius.pill }]}>
              <AppText variant="caption" style={{ color: colors.onNight, fontSize: 10, lineHeight: 12 }}>{lang.toUpperCase()}</AppText>
            </View>
          </View>
        )}
      </View>
      <AppText variant="caption" color={dictation.error ? 'dangerText' : 'textMuted'}>
        {dictation.error
          ? t(`voice.error.${dictation.error}`)
          : listening
            ? t('voice.listening')
            : canDictate
              ? t('voice.hintMicLang', { lang: t(`voice.langName.${lang}`) })
              : t('voice.hintKeyboard')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'flex-end', borderWidth: 1.5 },
  input: { flex: 1, textAlignVertical: 'top', paddingHorizontal: 4 },
  micWrap: { width: 44, height: 44 },
  mic: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  langChip: { position: 'absolute', right: -4, bottom: -4, paddingHorizontal: 4, paddingVertical: 1 },
});
