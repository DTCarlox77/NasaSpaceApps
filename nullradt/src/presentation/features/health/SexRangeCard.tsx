import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import type { IndicatorId } from '@/domain/entities/HealthIndicator';
import { RULES } from '@/domain/rules/ruleEngine';
import { sexReference, type Sex, type SexReference } from '@/domain/rules/sexReference';
import { AppText, Card } from '@/presentation/components/ui';

const fmt = (v?: number) => (v === undefined ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Texto del rango de una referencia: "57–95 lpm", "> 250 mg/día"… */
function rangeText(ref: SexReference, unit: string, labels: { upTo: (v: string) => string; atLeast: (v: string) => string }) {
  if (ref.min !== undefined && ref.max !== undefined) return `${fmt(ref.min)}–${fmt(ref.max)} ${unit}`;
  if (ref.max !== undefined) return labels.upTo(`${fmt(ref.max)} ${unit}`);
  if (ref.min !== undefined) return labels.atLeast(`${fmt(ref.min)} ${unit}`);
  return '—';
}

/**
 * "Rango normal para ti": referencia según tu sexo (y edad), comparada con la del otro sexo.
 * Si la fuente clínica usa el mismo rango para ambos sexos, se dice explícitamente.
 */
export function SexRangeCard({ id, unit, sex, age }: { id: IndicatorId; unit: string; sex: Sex; age: number }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const mine = sexReference(id, sex, age);
  const other: Sex = sex === 'male' ? 'female' : 'male';
  const theirs = sexReference(id, other, age);
  const bands = RULES[id].bands;

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Ionicons name={sex === 'male' ? 'male' : 'female'} size={20} color={colors.primaryText} />
        <AppText variant="h3" style={styles.flex}>{t('sexRange.title')}</AppText>
      </View>

      {mine.kind === 'same' ? (
        <>
          <AppText>{t('sexRange.same')}</AppText>
          {bands && (
            <View style={[styles.box, { borderRadius: radius.md, backgroundColor: colors.status.normal.background, padding: spacing.md }]}>
              <AppText variant="caption" style={{ color: colors.status.normal.text }}>{t('sexRange.bothSexes')}</AppText>
              <AppText variant="h3" style={{ color: colors.status.normal.text }}>{`${fmt(bands.normal[0])}–${fmt(bands.normal[1])} ${unit}`}</AppText>
            </View>
          )}
        </>
      ) : (
        <>
          <View style={[styles.row, { gap: spacing.sm }]}>
            {([sex, other] as Sex[]).map((s) => {
              const ref = s === sex ? mine : theirs;
              const isMe = s === sex;
              return (
                <View
                  key={s}
                  style={[
                    styles.flex,
                    {
                      padding: spacing.md,
                      gap: 2,
                      borderRadius: radius.md,
                      borderWidth: isMe ? 2 : 1,
                      borderColor: isMe ? colors.status.normal.solid : colors.border,
                      backgroundColor: isMe ? colors.status.normal.background : colors.surfaceAlt,
                    },
                  ]}
                >
                  <AppText variant="caption" color={isMe ? 'primaryText' : 'textMuted'}>
                    {t(`sexRange.sex.${s}`)}
                    {ref.ages ? ` · ${t('sexRange.ages', { ages: ref.ages })}` : ''}
                    {isMe ? ` · ${t('sexRange.you')}` : ''}
                  </AppText>
                  <AppText variant="h3" style={{ fontVariant: ['tabular-nums'] }}>{rangeText(ref, unit, { upTo: (value) => t('sexRange.upTo', { value }), atLeast: (value) => t('sexRange.atLeast', { value }) })}</AppText>
                  {ref.typical !== undefined && (
                    <AppText variant="caption" color="textSecondary">{t(`sexRange.typical.${id}` as never, { value: `${fmt(ref.typical)} ${unit}` })}</AppText>
                  )}
                </View>
              );
            })}
          </View>
          <AppText variant="bodySmall" color="textSecondary">{t(`sexRange.explain.${id}` as never)}</AppText>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center' }, flex: { flex: 1 }, box: { gap: 2 } });
