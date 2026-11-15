import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { speak } from '@/core/speech/speech';
import { AppText, Button } from '@/presentation/components/ui';
import { alertCrew } from '@/presentation/features/crew/crewAlerts';
import { useCrew } from '@/presentation/hooks/useCrew';
import { useTriageStore } from '@/presentation/store/triageStore';
import { sendTriageReport } from './triageReport';

/** Sin interacción durante IDLE_MS se pregunta "¿Sigues ahí?"; si nadie responde en CONFIRM_MS se envía todo solo. */
export const DEAD_MAN = { IDLE_MS: 60_000, CONFIRM_MS: 15_000 } as const;

// Se monta una sola vez en la raíz: cualquier toque en la app reinicia el contador (ver app/_layout.tsx).
let lastActivity = Date.now();
export const markActivity = () => {
  lastActivity = Date.now();
};

/**
 * Interruptor de hombre muerto: si quien hace el triaje queda incapacitado, la app
 * envía el reporte a Tierra y avisa a la tripulación sin que nadie toque nada.
 */
export function DeadManSwitch() {
  const { crew } = useCrew();
  const { t, i18n } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const active = useTriageStore((s) => !!s.active);
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'fired'>('idle');
  const [left, setLeft] = useState<number>(DEAD_MAN.CONFIRM_MS);
  const confirmStart = useRef(0);
  const lang = i18n.language === 'es' ? 'es' : 'en';

  const fire = useCallback(() => {
    setPhase('fired');
    sendTriageReport(crew, true);
    alertCrew({ kind: 'sos', severity: 'critical' });
    speak(t('triage.deadMan.firedVoice'), lang, { chime: 'critical' });
  }, [crew, t, lang]);

  const phaseRef = useRef<'idle' | 'confirm' | 'fired'>('idle');

  useEffect(() => {
    if (!active) return;
    markActivity();
    const id = setInterval(() => {
      const now = Date.now();
      if (phaseRef.current === 'idle' && now - lastActivity > DEAD_MAN.IDLE_MS) {
        confirmStart.current = now;
        phaseRef.current = 'confirm';
        setPhase('confirm');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        speak(t('triage.deadMan.voice'), lang, { chime: 'critical' });
      } else if (phaseRef.current === 'confirm') {
        const remaining = DEAD_MAN.CONFIRM_MS - (now - confirmStart.current);
        setLeft(Math.max(0, remaining));
        if (remaining <= 0) {
          phaseRef.current = 'fired';
          fire();
        }
      }
    }, 500);
    return () => clearInterval(id);
  }, [active, fire, t, lang]);

  const imOk = () => {
    markActivity();
    phaseRef.current = 'idle';
    setPhase('idle');
    setLeft(DEAD_MAN.CONFIRM_MS);
  };

  if (!active || phase === 'idle') return null;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={imOk}>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay, padding: spacing.xl }]}>
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xxl, gap: spacing.lg }]}>
          <Ionicons name={phase === 'fired' ? 'radio' : 'hand-left'} size={56} color={colors.status.critical.solid} />
          <AppText variant="h2" align="center">{phase === 'fired' ? t('triage.deadMan.firedTitle') : t('triage.deadMan.title')}</AppText>
          <AppText color="textSecondary" align="center">
            {phase === 'fired' ? t('triage.deadMan.firedBody') : t('triage.deadMan.body', { seconds: Math.ceil(left / 1000) })}
          </AppText>
          <Button label={phase === 'fired' ? t('triage.deadMan.continue') : t('triage.deadMan.imOk')} size="xl" fullWidth onPress={imOk} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sheet: { width: '100%', alignItems: 'center' },
});
