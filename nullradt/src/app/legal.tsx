import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { BrandMark } from '@/presentation/components/brand/BrandMark';
import { BackHeader } from '@/presentation/components/navigation/BackHeader';
import { AppText, Card, FadeInView, Screen, SegmentedControl } from '@/presentation/components/ui';

type Tab = 'terms' | 'privacy' | 'credits';
interface Section {
  title: string;
  body: string;
}

/** Equipo AndroMajes (nombres propios: no se traducen). */
const TEAM = [
  'Víctor Mateo Alcocer López',
  'Mauro Engelbert Delgado Saenz',
  'Carlos Adrián Espinosa Luna',
  'Claudia Sofía Vargas Ayerdis',
  'María Alejandra Sarante Salinas',
  'Jorge Adán Ortega Torres',
] as const;

/**
 * Términos y condiciones, política de privacidad y créditos.
 * Accesible sin sesión (desde el login) y con sesión (Ajustes). El contenido refleja lo que la app hace de verdad
 * (INTEGRACION.md §6–§7): confidencialidad del bienestar, qué queda en el servidor y qué en el dispositivo.
 */
export default function LegalScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const [tab, setTab] = useState<Tab>('terms');
  const sections = tab === 'credits' ? [] : (t(`legal.${tab}`, { returnObjects: true }) as unknown as Section[]);

  return (
    <Screen>
      <BackHeader title={t('legal.title')} subtitle={t('legal.subtitle')} fallback="/login" />

      <FadeInView index={1}>
        <SegmentedControl<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'terms', label: t('legal.tabs.terms'), icon: 'document-text-outline' },
            { value: 'privacy', label: t('legal.tabs.privacy'), icon: 'lock-closed-outline' },
            { value: 'credits', label: t('legal.tabs.credits'), icon: 'people-outline' },
          ]}
        />
      </FadeInView>

      {tab === 'credits' ? (
        <>
          <FadeInView index={2}>
            <Card tone="night" style={[styles.center, { gap: spacing.md, paddingVertical: spacing.xxl }]}>
              <BrandMark size={64} />
              <AppText variant="h2" align="center" style={{ color: colors.onNight }}>{t('legal.credits.ownerTitle')}</AppText>
              <AppText align="center" style={{ color: colors.onNightMuted }}>{t('legal.credits.ownerBody')}</AppText>
            </Card>
          </FadeInView>
          <FadeInView index={3}>
            <Card style={{ gap: spacing.md }}>
              <AppText variant="h3">{t('legal.credits.teamTitle')}</AppText>
              {TEAM.map((name) => (
                <View key={name} style={[styles.row, { gap: spacing.md }]}>
                  <View style={[styles.dot, { backgroundColor: colors.primarySoft, borderRadius: radius.pill }]}>
                    <Ionicons name="rocket-outline" size={16} color={colors.primaryText} />
                  </View>
                  <AppText style={styles.flex}>{name}</AppText>
                </View>
              ))}
            </Card>
          </FadeInView>
          <AppText variant="caption" color="textMuted" align="center">{t('legal.credits.nasaNote')}</AppText>
        </>
      ) : (
        <>
          <AppText variant="caption" color="textMuted">{t('legal.updated')}</AppText>
          {sections.map((s, i) => (
            <FadeInView key={`${tab}-${s.title}`} index={Math.min(i + 2, 8)}>
              <Card style={{ gap: spacing.xs }}>
                <AppText variant="title">{s.title}</AppText>
                <AppText color="textSecondary">{s.body}</AppText>
              </Card>
            </FadeInView>
          ))}
        </>
      )}

      <AppText variant="caption" color="textMuted" align="center" style={{ paddingVertical: spacing.md }}>
        {t('legal.copyright')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center' },
  dot: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
