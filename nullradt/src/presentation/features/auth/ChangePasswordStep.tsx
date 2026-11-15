import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { onboardServer } from '@/data/onboard/onboardServer';
import { isStrongPassword } from '@/domain/access/permissions';
import { AppText, Button, Card, TextField } from '@/presentation/components/ui';
import { useAuthStore } from '@/presentation/store/authStore';
import { showToast } from '@/presentation/store/toastStore';

/** Primer inicio con contraseña temporal: cambio obligatorio antes de entrar. */
export function ChangePasswordStep({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { spacing } = useAppTheme();
  const session = useAuthStore((s) => s.session);
  const updateSession = useAuthStore((s) => s.updateSession);
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!session) return;
    if (!isStrongPassword(next)) return setError(t('access.passwordPolicy'));
    if (next !== repeat) return setError(t('access.passwordMismatch'));
    setLoading(true);
    try {
      await onboardServer.changePassword(session.userId, next);
      await updateSession({ mustChangePassword: false });
      showToast({ level: 'normal', title: t('access.passwordChanged'), body: t('access.passwordChangedBody') });
      onDone();
    } catch {
      setError(t('access.passwordReuse'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ gap: spacing.xs }}>
        <AppText variant="h3">{t('access.mustChangeTitle')}</AppText>
        <AppText color="textSecondary">{t('access.mustChangeBody')}</AppText>
      </View>
      <Card style={{ gap: spacing.lg }}>
        <TextField label={t('access.newPassword')} icon="lock-closed-outline" password value={next} onChangeText={setNext} hint={t('access.passwordPolicy')} />
        <TextField label={t('access.repeatPassword')} icon="lock-closed-outline" password value={repeat} onChangeText={setRepeat} error={error} onSubmitEditing={submit} />
        <Button label={t('access.savePassword')} icon="arrow-forward" size="lg" fullWidth loading={loading} onPress={submit} />
      </Card>
    </View>
  );
}
