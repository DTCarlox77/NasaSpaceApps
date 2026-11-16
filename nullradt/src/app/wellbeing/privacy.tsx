import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { canView, DATA_CLASSES, VIEWER_PROFILES } from '@/domain/access/visibility';
import { BackHeader } from '@/presentation/components/navigation/BackHeader';
import { AppText, Card, FadeInView, Screen, ToggleRow } from '@/presentation/components/ui';
import { useAuthStore } from '@/presentation/store/authStore';
import { useTriageStore } from '@/presentation/store/triageStore';
import { useWellbeingStore } from '@/presentation/store/wellbeingStore';

/** Privacidad del bienestar: compartir (desactivado por defecto) y tabla "quién ve qué" calculada con la misma regla que aplica la app. */
export default function WellbeingPrivacyScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const userId = useAuthStore((s) => s.session?.userId ?? '');
  const shared = useWellbeingStore((s) => !!s.shareWithCrew[userId]);
  const setShare = useWellbeingStore((s) => s.setShareWithCrew);
  const emergency = useTriageStore((s) => !!s.active);
  const ctx = { sharedWithCrew: shared, emergency };

  return (
    <Screen>
      <BackHeader title={t('wellbeingPlus.privacy.title')} subtitle={t('wellbeingPlus.privacy.subtitle')} fallback="/wellbeing" />

      <FadeInView index={1}>
        <Card style={{ gap: spacing.sm }}>
          <ToggleRow icon="people-outline" title={t('wellbeingPlus.privacy.shareTitle')} description={t('wellbeingPlus.privacy.shareBody')} value={shared} onValueChange={(v) => setShare(userId, v)} />
        </Card>
      </FadeInView>

      {emergency && (
        <Card style={[styles.row, { gap: spacing.sm, backgroundColor: colors.status.critical.background, borderColor: colors.status.critical.ring }]}>
          <Ionicons name="medkit" size={20} color={colors.status.critical.text} />
          <AppText variant="bodySmall" style={[styles.flex, { color: colors.status.critical.text }]}>{t('wellbeingPlus.privacy.emergencyOn')}</AppText>
        </Card>
      )}

      <FadeInView index={2} style={{ gap: spacing.sm }}>
        <AppText variant="h3">{t('wellbeingPlus.privacy.whoSees')}</AppText>
        {VIEWER_PROFILES.map(({ key, viewer }) => (
          <Card key={key} style={{ gap: spacing.sm, padding: spacing.lg }}>
            <AppText variant="title">{t(`wellbeingPlus.privacy.viewers.${key}` as never)}</AppText>
            <View style={[styles.wrap, { gap: spacing.xs }]}>
              {DATA_CLASSES.map((d) => {
                const res = canView({ ...viewer, userId: `viewer-${key}` }, userId, d, ctx);
                return (
                  <View
                    key={d}
                    style={[
                      styles.row,
                      {
                        gap: 4,
                        paddingHorizontal: spacing.sm,
                        paddingVertical: 4,
                        borderRadius: radius.pill,
                        backgroundColor: res.allowed ? colors.status.normal.background : colors.surfaceAlt,
                        borderWidth: 1,
                        borderColor: res.allowed ? colors.status.normal.ring : colors.border,
                      },
                    ]}
                  >
                    <Ionicons name={res.allowed ? 'eye' : 'eye-off-outline'} size={14} color={res.allowed ? colors.status.normal.text : colors.textMuted} />
                    <AppText variant="caption" style={{ color: res.allowed ? colors.status.normal.text : colors.textMuted, textDecorationLine: res.allowed ? 'none' : 'line-through' }}>
                      {t(`wellbeingPlus.privacy.data.${d}`)}
                      {res.allowed && res.reason !== 'role' ? ` (${t(`wellbeingPlus.privacy.reason.${res.reason}` as never)})` : ''}
                    </AppText>
                  </View>
                );
              })}
            </View>
          </Card>
        ))}
        <AppText variant="caption" color="textMuted">{t('wellbeingPlus.privacy.footer')}</AppText>
      </FadeInView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
