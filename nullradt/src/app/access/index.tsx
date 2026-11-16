import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { randomId, sha256Hex } from '@/core/security/crypto';
import { actorFrom, AUTH_CONFIG, decodeClaims, onboardServer, useOnboardStore } from '@/data/onboard/onboardServer';
import { can } from '@/domain/access/permissions';
import { globalRoleOf, PermissionDeniedError, TokenReuseError, WeakPasswordError, type GlobalRole, type MissionCrewRole } from '@/domain/entities/Session';
import { BackHeader } from '@/presentation/components/navigation/BackHeader';
import { AppText, Button, Card, FadeInView, Screen, SegmentedControl, TextField } from '@/presentation/components/ui';
import { PinPad } from '@/presentation/features/auth/PinPad';
import { formatDuration, useNow } from '@/presentation/hooks/useNow';
import { rotateTokens } from '@/presentation/hooks/useTokenRefresh';
import { useAuthStore } from '@/presentation/store/authStore';
import { useDeviceStore } from '@/presentation/store/deviceStore';
import { showToast } from '@/presentation/store/toastStore';

/**
 * Seguridad y acceso: cuenta, tokens (JWT + refresh rotativo con detección de reuso), PIN sin conexión,
 * alta de cuentas (solo control de misión) y permisos delegados del comandante (auditados y reportados a Tierra).
 */
export default function AccessScreen() {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const session = useAuthStore((s) => s.session);
  const signOut = useAuthStore((s) => s.signOut);
  const lock = useAuthStore((s) => s.lock);
  const audit = useOnboardStore((s) => s.audit);
  const now = useNow(1000);
  if (!session) return null;

  const actor = actorFrom(session);
  const isAdmin = can(actor, 'createAccount').allowed;
  const delegated = !isAdmin && can(actor, 'unlockAccount').allowed;
  const onboard = session.authMode === 'onboard';
  const claims = onboard ? decodeClaims(session.token) : null;
  const myAudit = isAdmin || delegated ? audit : audit.filter((a) => a.actorId === session.userId || a.targetId === session.userId);

  return (
    <Screen>
      <BackHeader title={t('access.title')} subtitle={t('access.subtitle')} />

      <FadeInView index={1}>
        <Card style={{ gap: spacing.sm }}>
          <AppText variant="h3">{session.displayName}</AppText>
          <AppText color="textSecondary">
            {session.userId} · {t(`auth.roles.${globalRoleOf(session)}`)}
            {session.crewRole ? ` · ${t(`crewRoles.${session.crewRole}`)}` : ''}
          </AppText>
          {session.missionId && <AppText variant="caption" color="textMuted">{t('access.mission', { id: session.missionId })}</AppText>}
          <AppText variant="caption" color="textMuted">{t(`access.authModes.${session.authMode ?? 'demoAuto'}`)}</AppText>
          {!onboard && <Button label={t('access.signInOnboard')} variant="outline" leftIcon="log-in-outline" onPress={signOut} />}
        </Card>
      </FadeInView>

      {onboard && (
        <FadeInView index={2}>
          <Card style={{ gap: spacing.md }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Ionicons name="key-outline" size={20} color={colors.primaryText} />
              <AppText variant="h3" style={styles.flex}>{t('access.tokensTitle')}</AppText>
            </View>
            <AppText variant="bodySmall" color="textSecondary">
              {t('access.accessExpires', { eta: formatDuration(new Date(session.accessExpiresAt ?? now).getTime() - now) })}
            </AppText>
            {claims && <AppText variant="caption" color="textMuted">JWT · sub {claims.sub} · role {claims.role}{claims.crewRole ? `/${claims.crewRole}` : ''} · dev {claims.dev}</AppText>}
            <AppText variant="caption" color="textMuted">{t('access.refreshExplain')}</AppText>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <View style={styles.flex}>
                <Button label={t('access.rotate')} variant="secondary" size="sm" leftIcon="refresh" fullWidth onPress={async () => (await rotateTokens()) && showToast({ level: 'normal', title: t('access.rotated'), body: t('access.rotatedBody') })} />
              </View>
              <View style={styles.flex}>
                <Button
                  label={t('access.simulateReuse')}
                  variant="danger"
                  size="sm"
                  leftIcon="skull-outline"
                  fullWidth
                  onPress={async () => {
                    // Un atacante se queda con el refresh token actual; el usuario legítimo rota; el atacante intenta usar el viejo.
                    const stolen = useAuthStore.getState().session?.refreshToken;
                    await rotateTokens();
                    try {
                      if (stolen) onboardServer.refresh(stolen);
                    } catch (e) {
                      if (e instanceof TokenReuseError) {
                        showToast({ level: 'critical', title: t('access.reuseTitle'), body: t('access.reuseBody') });
                        await signOut();
                      }
                    }
                  }}
                />
              </View>
            </View>
          </Card>
        </FadeInView>
      )}

      {onboard && <PinSection />}

      <FadeInView index={4}>
        <Card tone="alt" style={{ gap: spacing.xs }}>
          <AppText variant="title">{t('access.policyTitle')}</AppText>
          <AppText variant="bodySmall" color="textSecondary">{t('access.policyBody', { attempts: AUTH_CONFIG.maxAttempts, minutes: AUTH_CONFIG.lockMinutes, hours: AUTH_CONFIG.offlineUnlockHours, ttl: AUTH_CONFIG.accessTtlMin })}</AppText>
          {onboard && <Button label={t('access.lockNow')} variant="ghost" size="sm" leftIcon="lock-closed-outline" onPress={lock} />}
        </Card>
      </FadeInView>

      {isAdmin && <CreateAccountSection />}
      {(isAdmin || delegated) && <AccountsSection delegated={delegated} />}
      {(isAdmin || delegated) && <DevicesSection />}

      <FadeInView index={8} style={{ gap: spacing.sm }}>
        <AppText variant="h3">{t('access.auditTitle')}</AppText>
        {myAudit.length === 0 && <AppText color="textSecondary">{t('access.auditEmpty')}</AppText>}
        {myAudit.slice(0, 15).map((a) => (
          <Card key={a.id} tone="alt" style={{ gap: 2, padding: spacing.md }}>
            <AppText variant="label">
              {t(`access.auditActions.${a.action}`)}
              {a.delegated ? ` · ${t('access.delegatedTag')}` : ''}
            </AppText>
            <AppText variant="caption" color="textSecondary">
              {new Date(a.at).toLocaleString()} · {a.actorId}
              {a.targetId ? ` → ${a.targetId}` : ''}
              {a.detail ? ` · ${a.detail}` : ''}
            </AppText>
          </Card>
        ))}
      </FadeInView>
    </Screen>
  );
}

function PinSection() {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const session = useAuthStore((s) => s.session)!;
  const updateSession = useAuthStore((s) => s.updateSession);
  const [step, setStep] = useState<'idle' | 'enter' | 'confirm'>('idle');
  const [first, setFirst] = useState('');
  const [error, setError] = useState<string | null>(null);
  const hasPin = onboardServer.hasPin(session.userId);

  return (
    <FadeInView index={3}>
      <Card style={{ gap: spacing.md }}>
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Ionicons name="keypad-outline" size={20} color={colors.primaryText} />
          <AppText variant="h3" style={styles.flex}>{t('access.pinTitle')}</AppText>
        </View>
        <AppText variant="bodySmall" color="textSecondary">
          {hasPin && session.offlineUnlockUntil ? t('access.pinActive', { date: new Date(session.offlineUnlockUntil).toLocaleString() }) : t('access.pinNone')}
        </AppText>
        {step === 'idle' ? (
          <Button label={hasPin ? t('access.changePin') : t('access.setPin')} variant="secondary" leftIcon="keypad-outline" onPress={() => setStep('enter')} />
        ) : (
          <>
            <AppText variant="title" align="center">{step === 'enter' ? t('access.pinEnter') : t('access.pinConfirm')}</AppText>
            <PinPad
              key={step}
              error={error}
              onComplete={async (pin) => {
                setError(null);
                if (step === 'enter') {
                  setFirst(pin);
                  setStep('confirm');
                  return;
                }
                if (pin !== first) {
                  setError(t('access.pinMismatch'));
                  setStep('enter');
                  return;
                }
                try {
                  const until = await onboardServer.setPin(session.userId, pin);
                  await updateSession({ offlineUnlockUntil: until });
                  showToast({ level: 'normal', title: t('access.pinSaved'), body: t('access.pinSavedBody') });
                  setStep('idle');
                  return true;
                } catch (e) {
                  setError(e instanceof WeakPasswordError ? t('access.pinWeak') : t('auth.errors.network'));
                  setStep('enter');
                }
              }}
            />
            <Button label={t('alert.cancel')} variant="ghost" onPress={() => setStep('idle')} />
          </>
        )}
      </Card>
    </FadeInView>
  );
}

function CreateAccountSection() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const session = useAuthStore((s) => s.session)!;
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<GlobalRole>('astronaut');
  const [crewRole, setCrewRole] = useState<MissionCrewRole>('mission_specialist');
  const [created, setCreated] = useState<{ id: string; temporaryPassword: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (fullName.trim().length < 3) return;
    setBusy(true);
    try {
      const res = await onboardServer.createAccount(actorFrom(session), { fullName, displayName: '', globalRole: role, crewRole });
      setCreated(res);
      setFullName('');
    } catch (e) {
      showToast({ level: 'caution', title: t('access.denied'), body: e instanceof PermissionDeniedError ? t('access.deniedBody') : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <FadeInView index={5}>
      <Card style={{ gap: spacing.md }}>
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Ionicons name="person-add-outline" size={20} color={colors.primaryText} />
          <AppText variant="h3" style={styles.flex}>{t('access.createTitle')}</AppText>
        </View>
        {created ? (
          <View style={{ gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.status.caution.background }}>
            <AppText variant="title" style={{ color: colors.status.caution.text }}>{t('access.createdOnce')}</AppText>
            <AppText variant="h3" selectable>{created.id}</AppText>
            <AppText variant="h2" selectable style={{ fontVariant: ['tabular-nums'], letterSpacing: 1 }}>{created.temporaryPassword}</AppText>
            <AppText variant="caption" style={{ color: colors.status.caution.text }}>{t('access.createdBody')}</AppText>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <View style={styles.flex}>
                <Button label={t('access.copy')} variant="outline" size="sm" leftIcon="copy-outline" fullWidth onPress={() => Clipboard.setStringAsync(`${created.id} / ${created.temporaryPassword}`)} />
              </View>
              <View style={styles.flex}>
                <Button label={t('access.hideForever')} size="sm" leftIcon="eye-off-outline" fullWidth onPress={() => setCreated(null)} />
              </View>
            </View>
          </View>
        ) : (
          <>
            <TextField label={t('access.fullName')} value={fullName} onChangeText={setFullName} icon="person-outline" />
            <SegmentedControl<GlobalRole>
              value={role}
              onChange={setRole}
              options={[
                { value: 'astronaut', label: t('access.roleShort.astronaut') },
                { value: 'flight_surgeon', label: t('access.roleShort.flight_surgeon') },
                { value: 'behavioral_health', label: t('access.roleShort.behavioral_health') },
                { value: 'admin', label: t('access.roleShort.admin') },
              ]}
            />
            {role === 'astronaut' && (
              <SegmentedControl<MissionCrewRole>
                value={crewRole}
                onChange={setCrewRole}
                options={[
                  { value: 'mission_specialist', label: t('crewRoles.mission_specialist') },
                  { value: 'crew_medical_officer', label: t('crewRoles.crew_medical_officer') },
                  { value: 'commander', label: t('crewRoles.commander') },
                ]}
              />
            )}
            <AppText variant="caption" color="textMuted">{t('access.createHint')}</AppText>
            <Button label={t('access.create')} leftIcon="add" loading={busy} disabled={fullName.trim().length < 3} onPress={create} />
          </>
        )}
      </Card>
    </FadeInView>
  );
}

function AccountsSection({ delegated }: { delegated: boolean }) {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const session = useAuthStore((s) => s.session)!;
  const accounts = useOnboardStore((s) => s.accounts);
  const now = useNow(5000);
  const actor = actorFrom(session);
  const list = Object.values(accounts).filter((a) => (delegated ? a.missionId === session.missionId : true));

  const run = (fn: () => void, ok: string) => {
    try {
      fn();
      showToast({ level: 'normal', title: ok, body: delegated ? t('access.reportedToEarth') : t('access.done') });
    } catch {
      showToast({ level: 'caution', title: t('access.denied'), body: t('access.deniedBody') });
    }
  };

  return (
    <FadeInView index={6} style={{ gap: spacing.sm }}>
      <AppText variant="h3">{delegated ? t('access.delegatedTitle') : t('access.accountsTitle')}</AppText>
      {delegated && <AppText variant="caption" color="textSecondary">{t('access.delegatedBody')}</AppText>}
      {list.map((a) => {
        const locked = !!a.lockedUntil && a.lockedUntil > now;
        return (
          <Card key={a.id} tone="alt" style={{ gap: spacing.sm, padding: spacing.md }}>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Ionicons name={locked ? 'lock-closed' : 'person-circle-outline'} size={22} color={locked ? colors.dangerText : colors.primaryText} />
              <View style={styles.flex}>
                <AppText variant="title">{a.displayName}</AppText>
                <AppText variant="caption" color="textSecondary">
                  {a.id} · {t(`auth.roles.${a.globalRole}`)}
                  {a.crewRole ? ` · ${t(`crewRoles.${a.crewRole}`)}` : ''}
                  {a.mustChangePassword ? ` · ${t('access.tempPassword')}` : ''}
                  {a.pinHash ? ` · PIN` : ''}
                </AppText>
                {locked && <AppText variant="caption" color="dangerText">{t('access.lockedUntil', { time: new Date(a.lockedUntil!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</AppText>}
              </View>
            </View>
            {a.id !== session.userId && (
              <View style={[styles.row, { gap: spacing.sm }]}>
                <View style={styles.flex}>
                  <Button label={t('access.unlock')} variant="outline" size="sm" leftIcon="lock-open-outline" fullWidth disabled={!locked} onPress={() => run(() => onboardServer.unlockAccount(actor, a.id), t('access.unlocked'))} />
                </View>
                <View style={styles.flex}>
                  <Button label={t('access.resetPin')} variant="outline" size="sm" leftIcon="keypad-outline" fullWidth disabled={!a.pinHash} onPress={() => run(() => onboardServer.resetPin(actor, a.id), t('access.pinReset'))} />
                </View>
              </View>
            )}
          </Card>
        );
      })}
    </FadeInView>
  );
}

function DevicesSection() {
  const { t } = useTranslation();
  const { colors, spacing } = useAppTheme();
  const session = useAuthStore((s) => s.session)!;
  const devices = useOnboardStore((s) => s.devices);
  const thisDevice = useDeviceStore((s) => s.deviceId);
  const [label, setLabel] = useState('');

  const register = () => {
    try {
      // La tableta de repuesto genera su propio secreto; al servidor solo llega la huella.
      const spareSecret = randomId(32);
      onboardServer.registerDevice(actorFrom(session), { deviceId: `TAB-${randomId(6)}`, label: label.trim() || t('access.spareDefault'), fingerprint: sha256Hex(spareSecret) });
      setLabel('');
      showToast({ level: 'normal', title: t('access.deviceRegistered'), body: t('access.reportedToEarth') });
    } catch {
      showToast({ level: 'caution', title: t('access.denied'), body: t('access.deniedBody') });
    }
  };

  return (
    <FadeInView index={7}>
      <Card style={{ gap: spacing.md }}>
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Ionicons name="tablet-portrait-outline" size={20} color={colors.primaryText} />
          <AppText variant="h3" style={styles.flex}>{t('access.devicesTitle')}</AppText>
        </View>
        <AppText variant="caption" color="textSecondary">{t('access.devicesBody')}</AppText>
        {Object.values(devices).map((d) => (
          <View key={d.deviceId} style={[styles.row, { gap: spacing.sm }]}>
            <Ionicons name="checkmark-circle" size={18} color={colors.primaryText} />
            <AppText variant="bodySmall" style={styles.flex}>
              {d.label} · {d.deviceId}
              {d.deviceId === thisDevice ? ` (${t('access.thisDevice')})` : ''}
            </AppText>
            <AppText variant="caption" color="textMuted">{d.registeredBy}</AppText>
          </View>
        ))}
        <TextField label={t('access.spareLabel')} value={label} onChangeText={setLabel} placeholder={t('access.spareDefault')} />
        <Button label={t('access.registerSpare')} variant="secondary" leftIcon="add-circle-outline" onPress={register} />
      </Card>
    </FadeInView>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center' } });
