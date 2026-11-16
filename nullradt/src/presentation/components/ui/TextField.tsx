import { forwardRef, useState, type ComponentRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppText } from './AppText';
import { PressableScale } from './PressableScale';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  hint?: string;
  error?: string | null;
  /** Campo de contraseña con botón de mostrar/ocultar. */
  password?: boolean;
  /** Texto fijo antes del valor (no editable), p. ej. "NR-A-". */
  prefix?: string;
}

/** Instancia del input (para `.focus()`); en RN 0.88 no es la clase TextInput. */
export type TextFieldHandle = ComponentRef<typeof TextInput>;

/** Figma Input: h-12, rounded-xl, borde line-strong; foco 2px brand-700; error borde crit + ícono. */
export const TextField = forwardRef<TextFieldHandle, TextFieldProps>(function TextField(
  { label, icon, hint, error, password, prefix, ...rest },
  ref,
) {
  const { t } = useTranslation();
  const { colors, radius, spacing, typography } = useAppTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);

  const borderColor = error ? colors.danger : focused ? colors.primaryStrong : colors.borderStrong;

  return (
    <View style={{ gap: spacing.xs + 2 }}>
      <AppText variant="label">{label}</AppText>
      <View
        style={[
          styles.box,
          {
            borderColor,
            borderWidth: focused || error ? 2 : 1,
            borderRadius: radius.md,
            backgroundColor: colors.surface,
            paddingHorizontal: spacing.md,
            gap: spacing.sm,
          },
        ]}
      >
        {icon && <Ionicons name={icon} size={20} color={focused ? colors.primaryText : colors.textMuted} />}
        {prefix && <AppText style={[typography.body, { color: colors.textSecondary, marginRight: -spacing.sm + 2 }]}>{prefix}</AppText>}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={hint}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={password && hidden}
          autoCapitalize={password ? 'none' : rest.autoCapitalize}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[typography.body, styles.input, { color: colors.text }]}
          {...rest}
        />
        {password && (
          <PressableScale
            haptic={false}
            accessibilityLabel={hidden ? t('auth.showPassword') : t('auth.hidePassword')}
            onPress={() => setHidden((h) => !h)}
            style={styles.eye}
          >
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={colors.textMuted} />
          </PressableScale>
        )}
      </View>
      {error ? (
        <View style={[styles.row, { gap: spacing.xs }]}>
          <Ionicons name="alert-circle" size={16} color={colors.dangerText} />
          <AppText variant="bodySmall" color="dangerText" style={styles.flex}>{error}</AppText>
        </View>
      ) : hint ? (
        <AppText variant="bodySmall" color="textMuted">{hint}</AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  input: { flex: 1, paddingVertical: 10 },
  eye: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
