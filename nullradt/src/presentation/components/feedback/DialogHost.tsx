import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useAppTheme } from '@/core/theme';
import { AppText, Button } from '@/presentation/components/ui';
import { useAuthStore } from '@/presentation/store/authStore';
import { useDialogStore, type DialogTone } from '@/presentation/store/dialogStore';

/**
 * Diálogo modal propio (tipografías, colores de estado, botones y radios de la app; claro y oscuro).
 * Se monta una vez en la raíz, como ToastHost. Uso: `showDialog({ title, body, actions })`.
 * Pertenece a la sesión: si se bloquea, vence o se cierra, el diálogo se descarta (no aparece sobre el login).
 */
export function DialogHost() {
  const { colors, spacing, radius, shadows } = useAppTheme();
  const dialog = useDialogStore((s) => s.current);
  const close = useDialogStore((s) => s.close);
  const unlocked = useAuthStore((s) => s.status === 'unlocked');

  useEffect(() => {
    if (!unlocked) close();
  }, [unlocked, close]);

  const tone: DialogTone = dialog?.tone ?? 'brand';
  const toneColors =
    tone === 'critical'
      ? { bg: colors.status.critical.background, fg: colors.status.critical.text }
      : tone === 'caution'
        ? { bg: colors.status.caution.background, fg: colors.status.caution.text }
        : tone === 'info'
          ? { bg: colors.surfaceTinted, fg: colors.textSecondary }
          : { bg: colors.primarySoft, fg: colors.primaryText };

  const dismiss = () => {
    if (dialog?.dismissable !== false) close();
  };

  return (
    <Modal visible={!!dialog && unlocked} transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      {dialog && unlocked && (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={[styles.backdrop, { backgroundColor: colors.overlay, padding: spacing.xl }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel={dialog.title} accessibilityRole="button" />
          <Animated.View
            entering={ZoomIn.duration(200)}
            accessibilityViewIsModal
            accessibilityRole="alert"
            style={[
              styles.card,
              shadows.lg,
              { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.sheet, padding: spacing.xl, gap: spacing.lg },
            ]}
          >
            {dialog.icon && (
              <View style={[styles.icon, { backgroundColor: toneColors.bg }]}>
                <Ionicons name={dialog.icon} size={30} color={toneColors.fg} />
              </View>
            )}
            <View style={{ gap: spacing.sm }}>
              <AppText variant="h3" align="center">{dialog.title}</AppText>
              {dialog.body ? <AppText color="textSecondary" align="center">{dialog.body}</AppText> : null}
            </View>
            <View style={{ gap: spacing.sm }}>
              {dialog.actions.map((a, i) => (
                <Button
                  key={`${a.label}-${i}`}
                  label={a.label}
                  variant={a.variant ?? (i === 0 ? 'primary' : 'ghost')}
                  leftIcon={a.icon}
                  fullWidth
                  onPress={() => {
                    close();
                    a.onPress?.();
                  }}
                />
              ))}
            </View>
          </Animated.View>
        </Animated.View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { width: '100%', maxWidth: 420, borderWidth: 1 },
  icon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
});
