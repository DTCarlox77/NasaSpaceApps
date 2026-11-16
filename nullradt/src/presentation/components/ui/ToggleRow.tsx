import { StyleSheet, Switch, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppTheme } from '@/core/theme';
import { AppText } from './AppText';

export interface ToggleRowProps {
  title: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

/** Fila con interruptor (ajustes, opciones de login). Toda la fila es el área táctil del switch. */
export function ToggleRow({ title, description, icon, value, onValueChange, disabled }: ToggleRowProps) {
  const { colors, spacing, radius } = useAppTheme();
  return (
    <View
      accessible
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      onAccessibilityTap={() => !disabled && onValueChange(!value)}
      style={[styles.row, { gap: spacing.md, opacity: disabled ? 0.5 : 1 }]}
    >
      {icon && (
        <View style={[styles.icon, { backgroundColor: colors.surfaceTinted, borderRadius: radius.md }]}>
          <Ionicons name={icon} size={22} color={colors.primaryText} />
        </View>
      )}
      <View style={styles.flex}>
        <AppText variant="title">{title}</AppText>
        {description ? <AppText variant="caption" color="textSecondary">{description}</AppText> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.borderStrong, true: colors.primaryStrong }}
        thumbColor="#FFFFFF"
        ios_backgroundColor={colors.borderStrong}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
