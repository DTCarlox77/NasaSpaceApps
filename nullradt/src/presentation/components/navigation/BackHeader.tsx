import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppText, FadeInView, IconButton } from '@/presentation/components/ui';

/** Encabezado de pantallas apiladas: volver + título (+ subtítulo y acción opcionales). */
export function BackHeader({ title, subtitle, right, fallback = '/' }: { title: string; subtitle?: string; right?: ReactNode; fallback?: string }) {
  const { t } = useTranslation();
  const { spacing } = useAppTheme();
  const back = () => (router.canGoBack() ? router.back() : router.replace(fallback as never));
  return (
    <FadeInView style={[styles.row, { gap: spacing.md }]}>
      <IconButton icon="arrow-back" tone="filled" accessibilityLabel={t('common.back')} onPress={back} />
      <View style={styles.flex}>
        <AppText variant="h2" accessibilityRole="header">{title}</AppText>
        {subtitle ? <AppText variant="caption" color="textMuted">{subtitle}</AppText> : null}
      </View>
      {right}
    </FadeInView>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center' }, flex: { flex: 1 } });
