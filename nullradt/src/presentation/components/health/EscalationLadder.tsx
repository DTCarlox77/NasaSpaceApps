import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import type { EscalationLevel } from '@/domain/entities/HealthIndicator';
import { AppText } from '@/presentation/components/ui';

const STEPS: { id: EscalationLevel; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'self', icon: 'person-outline' },
  { id: 'crew', icon: 'people-outline' },
  { id: 'flightSurgeon', icon: 'medkit-outline' },
];

/** Escalera de escalamiento: autocuidado → tripulación → flight surgeon (resalta el nivel actual). */
export function EscalationLadder({ level }: { level: EscalationLevel }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const idx = STEPS.findIndex((s) => s.id === level);
  const tone = level === 'flightSurgeon' ? colors.status.critical : level === 'crew' ? colors.status.caution : colors.status.normal;
  return (
    <View style={{ gap: spacing.sm }} accessible accessibilityLabel={`${t('rules.escalationTitle')}: ${t(`escalation.${level}`)}`}>
      <AppText variant="label" color="textSecondary">{t('rules.escalationTitle')}</AppText>
      <View style={[styles.row, { gap: spacing.xs }]}>
        {STEPS.map((s, i) => {
          const active = i === idx;
          const passed = i < idx;
          return (
            <View key={s.id} style={[styles.row, styles.flex, { gap: spacing.xs }]}>
              <View
                style={[
                  styles.step,
                  {
                    borderRadius: radius.md,
                    padding: spacing.sm,
                    gap: 2,
                    backgroundColor: active ? tone.background : colors.surfaceAlt,
                    borderColor: active ? tone.solid : colors.border,
                    borderWidth: active ? 2 : 1,
                    opacity: passed || active ? 1 : 0.6,
                  },
                ]}
              >
                <Ionicons name={s.icon} size={18} color={active ? tone.text : colors.textMuted} />
                <AppText variant="caption" style={{ color: active ? tone.text : colors.textSecondary }} numberOfLines={2} align="center">
                  {t(`escalation.${s.id}`)}
                </AppText>
              </View>
              {i < STEPS.length - 1 && <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />}
            </View>
          );
        })}
      </View>
      <AppText variant="bodySmall" style={{ color: tone.text }}>{t(`rules.escalationBody.${level}`)}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  step: { flex: 1, alignItems: 'center' },
});
