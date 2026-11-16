import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import type { HealthSnapshot } from '@/domain/repositories/HealthRepository';
import { AppText } from '@/presentation/components/ui';
import { timeAgo } from './healthUi';

/** Indica de dónde vienen los datos: maqueta (sin backend), caché offline o backend. */
export function DataOriginNote({ snapshot }: { snapshot: HealthSnapshot }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  if (snapshot.origin === 'remote') return null;
  const mock = snapshot.origin === 'mock';
  return (
    <View
      style={[
        styles.row,
        {
          gap: spacing.sm,
          alignSelf: 'flex-start',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs + 2,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: mock ? colors.accent : colors.border,
          backgroundColor: mock ? 'transparent' : colors.surfaceSage,
        },
      ]}
    >
      <Ionicons name={mock ? 'flask-outline' : 'cloud-offline-outline'} size={14} color={mock ? colors.accentText : colors.textSecondary} />
      <AppText variant="caption" color={mock ? 'accentText' : 'textSecondary'}>
        {mock ? t('health.origin.mock') : t('health.origin.cache', { ago: timeAgo(snapshot.fetchedAt, t) })}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center' } });
