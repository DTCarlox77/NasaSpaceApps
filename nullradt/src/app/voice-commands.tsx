import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { BackHeader } from '@/presentation/components/navigation/BackHeader';
import { AppText, Button, Card, FadeInView, PressableScale, Screen, TextField, ToggleRow } from '@/presentation/components/ui';
import { handleCommand, useVoiceStore, voiceSupported, wakeManually } from '@/presentation/features/voice/voiceAssistant';
import { VOICE_COMMANDS, type CommandGroup } from '@/presentation/features/voice/voiceCommands';

const GROUPS: { id: CommandGroup; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'health', icon: 'heart-outline' },
  { id: 'measure', icon: 'pulse-outline' },
  { id: 'wellbeing', icon: 'happy-outline' },
  { id: 'routine', icon: 'time-outline' },
  { id: 'emergency', icon: 'medkit-outline' },
  { id: 'navigation', icon: 'compass-outline' },
  { id: 'system', icon: 'settings-outline' },
];

/** Comandos de voz: activar "NullRadt", lista de todo lo que se puede decir y prueba escrita (sirve en Expo Go). */
export default function VoiceCommandsScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const { enabled, setEnabled, status, lastCommand, lastReply, error } = useVoiceStore();
  const [typed, setTyped] = useState('');

  const run = (text: string) => {
    if (!text.trim()) return;
    handleCommand(text);
    setTyped('');
  };

  return (
    <Screen>
      <BackHeader title={t('assistant.screen.title')} subtitle={t('assistant.screen.subtitle')} />

      <FadeInView index={1}>
        <Card tone="night" style={{ gap: spacing.md }}>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Ionicons name="mic" size={22} color={colors.primary} />
            <AppText variant="h3" style={[styles.flex, { color: colors.onNight }]}>{t('assistant.screen.wake')}</AppText>
          </View>
          <AppText style={{ color: colors.onNightMuted }}>{voiceSupported ? t('assistant.screen.wakeBody') : t('assistant.screen.needsApk')}</AppText>
          {voiceSupported && (
            <>
              <AppText variant="caption" style={{ color: colors.onNightMuted }}>
                {t('assistant.screen.status', { status: t(`assistant.status.${status}`) })}
                {error === 'permission' ? ` · ${t('assistant.overlay.error')}` : ''}
              </AppText>
              <Button label={t('assistant.screen.talkNow')} leftIcon="mic-outline" variant="primary" onPress={wakeManually} />
            </>
          )}
        </Card>
      </FadeInView>

      {voiceSupported && (
        <Card style={{ gap: spacing.sm }}>
          <ToggleRow icon="ear-outline" title={t('assistant.screen.toggle')} description={t('assistant.screen.toggleBody')} value={enabled} onValueChange={setEnabled} />
        </Card>
      )}

      <FadeInView index={2}>
        <Card style={{ gap: spacing.md }}>
          <AppText variant="title">{t('assistant.screen.tryTitle')}</AppText>
          <TextField label={t('assistant.screen.tryLabel')} value={typed} onChangeText={setTyped} placeholder={t('assistant.screen.tryPlaceholder')} returnKeyType="send" onSubmitEditing={() => run(typed)} icon="chatbubble-ellipses-outline" />
          <Button label={t('assistant.screen.run')} leftIcon="play" disabled={!typed.trim()} onPress={() => run(typed)} />
          {lastCommand ? (
            <View style={{ gap: 2, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }}>
              <AppText variant="caption" color="textMuted">“{lastCommand}”</AppText>
              <AppText variant="bodySmall">{lastReply || '…'}</AppText>
            </View>
          ) : null}
        </Card>
      </FadeInView>

      {GROUPS.map((g, gi) => {
        const cmds = VOICE_COMMANDS.filter((c) => c.group === g.id);
        if (!cmds.length) return null;
        return (
          <FadeInView key={g.id} index={3 + gi} style={{ gap: spacing.sm }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Ionicons name={g.icon} size={18} color={colors.primaryText} />
              <AppText variant="h3">{t(`assistant.groups.${g.id}`)}</AppText>
            </View>
            {cmds.map((c) => {
              const examples = t(`assistant.cmd.${c.id}.examples` as never, { returnObjects: true }) as unknown as string[];
              return (
                <Card key={c.id} tone="alt" style={{ gap: spacing.xs, padding: spacing.md }}>
                  <AppText variant="title">{t(`assistant.cmd.${c.id}.title` as never)}</AppText>
                  <View style={[styles.wrap, { gap: spacing.xs }]}>
                    {(Array.isArray(examples) ? examples : []).map((ex) => (
                      <PressableScale
                        key={ex}
                        onPress={() => run(ex)}
                        accessibilityLabel={ex}
                        style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                      >
                        <AppText variant="caption">«NullRadt, {ex}»</AppText>
                      </PressableScale>
                    ))}
                  </View>
                </Card>
              );
            })}
          </FadeInView>
        );
      })}
      <AppText variant="caption" color="textMuted">{t('assistant.screen.footer')}</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center' }, wrap: { flexDirection: 'row', flexWrap: 'wrap' } });
