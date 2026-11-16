import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppText } from '../ui/AppText';

/** Aviso obligatorio: la app es de apoyo a la decisión, no diagnóstico. */
export function Disclaimer() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  return (
    <View style={[styles.row, { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt }]}>
      <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
      <AppText variant="caption" color="textSecondary" style={styles.flex}>
        {t('disclaimer')}
      </AppText>
    </View>
  );
}

export function SyntheticDataBadge() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  return (
    <View style={[styles.row, { alignSelf: 'flex-start', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.accent }]}>
      <Ionicons name="flask-outline" size={14} color={colors.accentText} />
      <AppText variant="caption" color="accentText">
        {t('common.syntheticData')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
