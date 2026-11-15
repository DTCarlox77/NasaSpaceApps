import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AccountLockedError, InvalidCredentialsError } from '@/domain/entities/Session';
import { PinPad } from './PinPad';
import {
  AppText,
  Button,
  Card,
  SegmentedControl,
  TextField,
  ToggleRow,
  type TextFieldHandle,
} from '@/presentation/components/ui';
import { useBiometrics } from '@/presentation/hooks/useBiometrics';
import { OfflineUnlockExpiredError, useAuthStore } from '@/presentation/store/authStore';
import { showToast } from '@/presentation/store/toastStore';

const ASTRONAUT_ID = /^NR-A-\d{4}$/;

const ID_PREFIX = 'NR-A-';
/** El campo solo guarda los 4 dígitos; el prefijo "NR-A-" es fijo (evita que el teclado duplique texto al reformatear). */
export const idDigits = (input: string) => input.toUpperCase().replace(/^NR-?A-?/, '').replace(/\D/g, '').slice(0, 4);
type Method = 'biometric' | 'password' | 'pin';
type ScanState = 'idle' | 'scanning' | 'verified';

const initials = (name: string) =>
  name
    .replace(/[^A-Za-zÀ-ÿ0-9 -]/g, '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** Paso 1 del login: identificarse con biometría (si hay sesión guardada) o con ID de astronauta + contraseña. */
export function IdentifyStep({ onVerified }: { onVerified: (method: Method) => void }) {
  const { t } = useTranslation();
  const { colors, spacing, radius, shadows } = useAppTheme();
  const { session, status, verifyPassword, biometricEnabled, hasPin } = useAuthStore();
  const biometrics = useBiometrics();
  const locked = status === 'locked' && !!session;
  const [openedAt] = useState(() => Date.now());
  const canUseBiometric = locked && biometricEnabled;
  // PIN sin conexión: solo si existe y no caducó offline_unlock_until.
  const canUsePin = locked && hasPin() && !!session?.offlineUnlockUntil && new Date(session.offlineUnlockUntil).getTime() > openedAt;

  // Preferencia del usuario; si el método deja de estar disponible, se usa contraseña.
  const [preferred, setMethod] = useState<Method>(canUseBiometric ? 'biometric' : 'pin');
  const method: Method = preferred === 'biometric' && canUseBiometric ? 'biometric' : preferred === 'pin' && canUsePin ? 'pin' : 'password';

  return (
    <View style={{ gap: spacing.xl }}>
      {locked && session && (
        <View style={[styles.row, shadows.md, { gap: spacing.md, padding: spacing.lg, borderRadius: radius.button, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}>
          <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
            <AppText variant="title" color="primaryText">{initials(session.displayName)}</AppText>
          </View>
          <View style={styles.flex}>
            <AppText variant="title">{session.displayName}</AppText>
            <AppText variant="bodySmall" color="textMuted">{t(`auth.roles.${session.role}`)}</AppText>
          </View>
          <View style={[styles.row, { gap: spacing.xs }]}>
            <Ionicons name="lock-closed" size={14} color={colors.primaryText} />
            <AppText variant="label" color="primaryText" style={{ fontSize: 12 }}>{t('auth.thisDevice')}</AppText>
          </View>
        </View>
      )}

      {(canUseBiometric || canUsePin) && (
        <SegmentedControl<Method>
          value={method}
          onChange={setMethod}
          options={[
            ...(canUseBiometric ? [{ value: 'biometric' as const, label: biometrics.methodLabelTitle, icon: biometrics.icon }] : []),
            ...(canUsePin ? [{ value: 'pin' as const, label: t('access.pin'), icon: 'keypad-outline' as const }] : []),
            { value: 'password' as const, label: t('auth.idAndPassword'), icon: 'key-outline' as const },
          ]}
        />
      )}

      {method === 'biometric' && canUseBiometric ? (
        <BiometricCard onVerified={() => onVerified('biometric')} />
      ) : method === 'pin' ? (
        <PinCard onVerified={() => onVerified('pin')} />
      ) : (
        <PasswordForm verifyPassword={verifyPassword} onVerified={() => onVerified('password')} />
      )}
    </View>
  );
}

function BiometricCard({ onVerified }: { onVerified: () => void }) {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const biometrics = useBiometrics();
  const [scan, setScan] = useState<ScanState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const prompted = useRef(false);

  const pulse = useSharedValue(0);
  useEffect(() => {
    if (scan === 'scanning') pulse.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false);
    else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
  }, [scan, pulse]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - pulse.value), transform: [{ scale: 0.8 + pulse.value * 1.1 }] }));

  const verify = async () => {
    setMessage(null);
    setScan('scanning');
    const res = await biometrics.authenticate();
    if (res.ok) {
      setScan('verified');
      setTimeout(onVerified, 650); // Figma: pausa breve en "Identidad verificada"
      return;
    }
    setScan('idle');
    if (res.reason === 'notAvailable') setMessage(t('auth.unlockUnavailable'));
    else if (res.reason === 'lockout') setMessage(t('auth.unlockLockout'));
    else if (res.reason === 'failed') setMessage(t('auth.unlockFailed'));
  };

  // Pedir la biometría automáticamente una vez al abrir.
  useEffect(() => {
    if (biometrics.capability && !prompted.current) {
      prompted.current = true;
      verify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometrics.capability]);

  const verified = scan === 'verified';
  const statusText = verified
    ? t('auth.scan.verified')
    : scan === 'scanning'
      ? t('auth.scan.reading')
      : t('auth.scan.idle', { method: biometrics.methodLabel });

  return (
    <Card style={[styles.center, { gap: spacing.lg, padding: spacing.xxl }]}>
      <View style={styles.scanWrap}>
        {scan === 'scanning' && <Animated.View style={[styles.scanRing, { backgroundColor: colors.primary }, ringStyle]} />}
        <View
          style={[
            styles.scanCircle,
            {
              backgroundColor: verified ? colors.primary : colors.surfaceTinted,
              borderColor: verified ? colors.primary : colors.status.normal.ring,
            },
          ]}
        >
          <Ionicons name={verified ? 'checkmark-circle' : biometrics.icon} size={44} color={verified ? colors.onPrimary : colors.primaryText} />
        </View>
      </View>
      <AppText variant="h3" align="center" accessibilityLiveRegion="polite">{statusText}</AppText>
      {message && <AppText variant="bodySmall" color="dangerText" align="center">{message}</AppText>}
      <Button
        label={scan === 'scanning' ? t('auth.verifying') : t('auth.verifyWith', { method: biometrics.methodLabel })}
        leftIcon={biometrics.icon}
        size="lg"
        fullWidth
        loading={scan === 'scanning'}
        disabled={verified}
        onPress={verify}
      />
    </Card>
  );
}

function PinCard({ onVerified }: { onVerified: () => void }) {
  const { t } = useTranslation();
  const { spacing } = useAppTheme();
  const unlockWithPin = useAuthStore((s) => s.unlockWithPin);
  const until = useAuthStore((s) => s.session?.offlineUnlockUntil);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Card style={{ gap: spacing.lg, alignItems: 'center' }}>
      <AppText variant="bodySmall" color="textSecondary" align="center">
        {t('access.pinOfflineUntil', { date: until ? new Date(until).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—' })}
      </AppText>
      <PinPad
        disabled={busy}
        error={error}
        onComplete={async (pin) => {
          setBusy(true);
          setError(null);
          try {
            await unlockWithPin(pin);
            onVerified();
            return true;
          } catch (e) {
            setError(
              e instanceof AccountLockedError
                ? t('access.lockedUntil', { time: new Date(e.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
                : e instanceof OfflineUnlockExpiredError
                  ? t('access.pinExpired')
                  : t('access.pinWrong'),
            );
            return false;
          } finally {
            setBusy(false);
          }
        }}
      />
    </Card>
  );
}

function PasswordForm({
  verifyPassword,
  onVerified,
}: {
  verifyPassword: ReturnType<typeof useAuthStore.getState>['verifyPassword'];
  onVerified: () => void;
}) {
  const { t } = useTranslation();
  const { spacing } = useAppTheme();
  const biometrics = useBiometrics();
  const setBiometricEnabled = useAuthStore((s) => s.setBiometricEnabled);
  const passwordRef = useRef<TextFieldHandle>(null);
  const [astronautId, setAstronautId] = useState('');
  const [password, setPassword] = useState('');
  const [saveBiometric, setSaveBiometric] = useState(true);
  const [idError, setIdError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);

  const submit = async () => {
    const id = `${ID_PREFIX}${astronautId}`;
    setIdError(ASTRONAUT_ID.test(id) ? null : t('auth.errors.idFormat'));
    setError(password ? null : t('auth.errors.passwordRequired'));
    if (!ASTRONAUT_ID.test(id) || !password) return;

    setLoading(true);
    try {
      // 1) Primero se validan ID y contraseña: si son incorrectos, no se pide la biometría.
      await verifyPassword({ identifier: id, password }, false);
      // 2) Solo con credenciales correctas se ofrece guardar la biometría (y se confirma con el sensor).
      if (saveBiometric && biometrics.available) {
        const res = await biometrics.authenticate();
        if (res.ok) {
          await setBiometricEnabled(true);
          showToast({ level: 'normal', title: t('auth.biometricSaved', { method: biometrics.methodLabelTitle }), body: t('auth.biometricSavedBody') });
        } else {
          showToast({ level: 'caution', title: t('auth.biometricNotSaved'), body: t('auth.biometricNotSavedBody') });
        }
      }
      setVerified(true);
      setTimeout(onVerified, 500);
    } catch (e) {
      setError(
        e instanceof AccountLockedError
          ? t('access.lockedUntil', { time: new Date(e.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
          : e instanceof InvalidCredentialsError
            ? t('auth.errors.invalid')
            : t('auth.errors.network'),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card style={{ gap: spacing.lg }}>
      <TextField
        label={t('auth.astronautId')}
        icon="id-card-outline"
        prefix={ID_PREFIX}
        placeholder="0000"
        value={astronautId}
        onChangeText={(v) => setAstronautId(idDigits(v))}
        keyboardType="number-pad"
        maxLength={4}
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
        textContentType="none"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        error={idError}
      />
      <TextField
        ref={passwordRef}
        label={t('auth.password')}
        icon="lock-closed-outline"
        placeholder="••••••••"
        password
        value={password}
        onChangeText={setPassword}
        autoComplete="password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
        error={error}
      />

      {biometrics.available && (
        <ToggleRow
          icon={biometrics.icon}
          title={t('auth.saveBiometric', { method: biometrics.methodLabel })}
          value={saveBiometric}
          onValueChange={setSaveBiometric}
        />
      )}

      <Button
        label={verified ? t('auth.verified') : loading ? t('auth.verifying') : t('auth.verifyIdentity')}
        icon={verified ? 'checkmark' : 'arrow-forward'}
        size="lg"
        fullWidth
        loading={loading}
        onPress={verified ? undefined : submit}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  center: { alignItems: 'center' },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  scanWrap: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center' },
  scanRing: { position: 'absolute', width: 112, height: 112, borderRadius: 56 },
  scanCircle: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
