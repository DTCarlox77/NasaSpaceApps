import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/presentation/components/ui';
import { useAuthStore } from '@/presentation/store/authStore';
import { activeSession, openMeasurement, pendingOf, useMeasureSessionStore } from '@/presentation/store/measureSessionStore';

/** Botones al terminar una medición dentro de la sesión: siguiente pendiente, volver a la lista o ver el resumen. */
export function SessionNext() {
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.session?.userId ?? '');
  const session = activeSession(useMeasureSessionStore((s) => s.session), userId);
  if (!session) return null;
  const remaining = pendingOf(session);
  const next = remaining[0];

  if (!next) {
    return <Button label={t('measureSession.seeSummary')} leftIcon="checkmark-done" size="lg" fullWidth onPress={() => router.back()} />;
  }
  if (session.mode === 'guided') {
    return (
      <Button
        label={t('measureSession.nextStep', { name: t(`indicators.${next}.name`), count: remaining.length })}
        icon="arrow-forward"
        size="lg"
        fullWidth
        onPress={() => openMeasurement(next, true)}
      />
    );
  }
  return <Button label={t('measureSession.backToList', { count: remaining.length })} leftIcon="list" size="lg" fullWidth onPress={() => router.back()} />;
}
