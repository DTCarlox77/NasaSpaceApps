import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppTheme } from '@/core/theme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

export interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, actionLabel, onAction }: SectionHeaderProps) {
  const { colors, spacing } = useAppTheme();
  return (
    <View style={styles.row}>
      <AppText variant="h3" style={styles.flex}>{title}</AppText>
      {actionLabel && onAction ? (
        <PressableScale onPress={onAction} style={[styles.row, { gap: spacing.xxs, paddingVertical: spacing.xs }]}>
          <AppText variant="label" color="primaryText">{actionLabel}</AppText>
          <Ionicons name="arrow-forward" size={14} color={colors.primaryText} />
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
