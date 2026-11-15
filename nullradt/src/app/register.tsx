import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { BODY_SYSTEMS, BODY_SYSTEM_IDS } from '@/domain/entities/BodySystem';
import type { IndicatorId } from '@/domain/entities/HealthIndicator';
import type { RuleResult } from '@/domain/rules/ruleEngine';
import { Disclaimer } from '@/presentation/components/feedback/Disclaimer';
import { EscalationLadder } from '@/presentation/components/health/EscalationLadder';
import { BackHeader } from '@/presentation/components/navigation/BackHeader';
import { AppText, Button, Card, FadeInView, PressableScale, Screen, StatusBadge, TextField } from '@/presentation/components/ui';
import { persistPhoto, recordReading } from '@/presentation/features/health/recordReading';
import { SessionNext } from '@/presentation/features/health/SessionNext';
import { useMeasureSessionStore } from '@/presentation/store/measureSessionStore';
import { showToast } from '@/presentation/store/toastStore';

const ALL: IndicatorId[] = BODY_SYSTEM_IDS.flatMap((s) => BODY_SYSTEMS[s].indicators);
const UNITS: Record<IndicatorId, string> = {
  heartRate: 'bpm',
  bloodPressure: 'mmHg',
  spo2: '%',
  respRate: 'rpm',
  reactionTime: 'ms',
  eyePressure: 'mmHg',
  urinaryCalcium: 'mg/día',
  gripStrength: 'kg',
  bodyTemperature: '°C',
};
/** Límites físicamente posibles (validación de tecleo, no son umbrales clínicos). */
const PLAUSIBLE: Record<IndicatorId, [number, number]> = {
  heartRate: [20, 250],
  bloodPressure: [50, 260],
  spo2: [50, 100],
  respRate: [3, 60],
  reactionTime: [100, 2000],
  eyePressure: [3, 60],
  urinaryCalcium: [10, 1000],
  gripStrength: [1, 120],
  bodyTemperature: [30, 44],
};

const parse = (s: string) => Number(s.replace(',', '.'));

/**
 * Registro manual o POR CÁMARA: foto del equipo de medición (evidencia) + valor leído.
 * Sin conexión no hay OCR fiable en el teléfono: el astronauta teclea el número que ve y la foto queda adjunta
 * para que el flight surgeon pueda verificarla.
 */
export default function RegisterScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const params = useLocalSearchParams<{ indicator?: IndicatorId; session?: string }>();
  const inSession = params.session === '1';
  const [id, setId] = useState<IndicatorId>(params.indicator && ALL.includes(params.indicator) ? params.indicator : 'heartRate');
  const [value, setValue] = useState('');
  const [secondary, setSecondary] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RuleResult | null>(null);
  const isBp = id === 'bloodPressure';

  const takePhoto = async (from: 'camera' | 'library') => {
    const perm = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showToast({ level: 'caution', title: t('register.permissionTitle'), body: t('register.permissionBody') });
      return;
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6 };
    const res = from === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (!res.canceled && res.assets[0]) setPhoto(res.assets[0].uri);
  };

  const submit = () => {
    const v = parse(value);
    const s = isBp ? parse(secondary) : undefined;
    const [lo, hi] = PLAUSIBLE[id];
    if (!value || Number.isNaN(v) || v < lo || v > hi || (isBp && (!secondary || Number.isNaN(s!) || s! < 20 || s! >= v))) {
      setError(t('register.invalid', { min: lo, max: hi }));
      return;
    }
    setError(null);
    const r = recordReading({ indicatorId: id, value: v, secondaryValue: s, source: photo ? 'camera' : 'manual', photoUri: photo ? persistPhoto(photo) : undefined, note: note.trim() || undefined });
    if (inSession) useMeasureSessionStore.getState().markDone(id);
    Haptics.notificationAsync(r.status === 'normal' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
    setResult(r);
  };

  const reset = () => {
    setResult(null);
    setValue('');
    setSecondary('');
    setNote('');
    setPhoto(null);
  };

  return (
    <Screen>
        <BackHeader title={t('register.title')} subtitle={t('register.subtitle')} fallback="/body" />

        {!result ? (
          <>
            {!inSession && (
            <FadeInView index={1} style={{ gap: spacing.sm }}>
              <AppText variant="label" color="textSecondary">{t('register.indicator')}</AppText>
              <View style={[styles.wrap, { gap: spacing.sm }]}>
                {ALL.map((iid) => {
                  const on = iid === id;
                  return (
                    <PressableScale
                      key={iid}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      onPress={() => {
                        setId(iid);
                        setError(null);
                      }}
                      style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, backgroundColor: on ? colors.night : colors.surfaceAlt, borderColor: on ? colors.night : colors.border }}
                    >
                      <AppText variant="label" style={{ color: on ? colors.onNight : colors.text }}>{t(`indicators.${iid}.short`)}</AppText>
                    </PressableScale>
                  );
                })}
              </View>
            </FadeInView>
            )}
            {inSession && <AppText variant="h3">{t(`indicators.${id}.name`)}</AppText>}

            <FadeInView index={2}>
              <Card style={{ gap: spacing.md }}>
                <View style={[styles.row, { gap: spacing.sm }]}>
                  <Ionicons name="camera-outline" size={20} color={colors.primaryText} />
                  <AppText variant="h3" style={styles.flex}>{t('register.photoTitle')}</AppText>
                </View>
                <AppText variant="bodySmall" color="textSecondary">{t('register.photoBody')}</AppText>
                {photo ? (
                  <Animated.View entering={FadeIn} style={{ gap: spacing.sm }}>
                    <Image source={{ uri: photo }} style={[styles.photo, { borderRadius: radius.md }]} resizeMode="cover" accessibilityLabel={t('register.photoA11y')} />
                    <Button label={t('register.retake')} variant="ghost" leftIcon="refresh" onPress={() => setPhoto(null)} />
                  </Animated.View>
                ) : (
                  <View style={[styles.row, { gap: spacing.sm }]}>
                    <View style={styles.flex}>
                      <Button label={t('register.camera')} leftIcon="camera" variant="dark" fullWidth onPress={() => takePhoto('camera')} />
                    </View>
                    <View style={styles.flex}>
                      <Button label={t('register.gallery')} leftIcon="images-outline" variant="outline" fullWidth onPress={() => takePhoto('library')} />
                    </View>
                  </View>
                )}
              </Card>
            </FadeInView>

            <FadeInView index={3}>
              <Card style={{ gap: spacing.md }}>
                <AppText variant="h3">{t('register.valueTitle')}</AppText>
                <View style={[styles.row, { gap: spacing.sm, alignItems: 'flex-start' }]}>
                  <View style={styles.flex}>
                    <TextField
                      label={isBp ? t('register.systolic') : t(`indicators.${id}.short`)}
                      value={value}
                      onChangeText={setValue}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      hint={UNITS[id]}
                    />
                  </View>
                  {isBp && (
                    <View style={styles.flex}>
                      <TextField label={t('register.diastolic')} value={secondary} onChangeText={setSecondary} keyboardType="number-pad" placeholder="0" hint="mmHg" />
                    </View>
                  )}
                </View>
                <TextField label={t('register.note')} value={note} onChangeText={setNote} placeholder={t('register.notePlaceholder')} />
                {error && <AppText variant="bodySmall" color="dangerText">{error}</AppText>}
                <Button label={t('register.evaluate')} leftIcon="checkmark-done" size="lg" fullWidth onPress={submit} />
              </Card>
            </FadeInView>
          </>
        ) : (
          <Animated.View entering={FadeIn.duration(250)} style={{ gap: spacing.lg }}>
            <Card style={[styles.center, { gap: spacing.md, paddingVertical: spacing.xxl, backgroundColor: colors.status[result.status].background, borderColor: colors.status[result.status].ring }]}>
              <StatusBadge status={result.status} size="lg" />
              <View style={[styles.row, { gap: 6, alignItems: 'baseline' }]}>
                <AppText variant="display" style={{ fontVariant: ['tabular-nums'] }}>{isBp ? `${value}/${secondary}` : value}</AppText>
                <AppText color="textMuted">{UNITS[id]}</AppText>
              </View>
              <AppText align="center" style={{ color: colors.status[result.status].text }}>{t(`rules.reasons.${result.reason}` as never)}</AppText>
              {photo && (
                <View style={[styles.row, { gap: spacing.xs }]}>
                  <Ionicons name="image-outline" size={16} color={colors.textMuted} />
                  <AppText variant="caption" color="textMuted">{t('register.photoAttached')}</AppText>
                </View>
              )}
            </Card>
            <Card style={{ gap: spacing.md }}>
              <EscalationLadder level={result.escalation} />
              {result.remeasureMin && <AppText variant="bodySmall" color="textSecondary">{t('rules.remeasure', { min: result.remeasureMin })}</AppText>}
            </Card>
            {result.status === 'critical' && (
              <Button label={t('triage.openAuto')} variant="danger" leftIcon="medkit" fullWidth onPress={() => router.push({ pathname: '/triage', params: { trigger: 'criticalReading' } })} />
            )}
            {inSession ? (
              <SessionNext />
            ) : (
              <>
                <Button label={t('register.seeDetail')} leftIcon="analytics-outline" size="lg" fullWidth onPress={() => router.replace({ pathname: '/indicator/[id]', params: { id } })} />
                <Button label={t('register.another')} variant="ghost" leftIcon="add" fullWidth onPress={reset} />
              </>
            )}
          </Animated.View>
        )}
        <Disclaimer />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  center: { alignItems: 'center', justifyContent: 'center' },
  photo: { width: '100%', height: 200 },
});
