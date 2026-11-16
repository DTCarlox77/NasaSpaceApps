import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Network from 'expo-network';
import { router } from 'expo-router';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import type { CrewMember } from '@/domain/entities/Crew';
import { Sparkline } from '@/presentation/components/health/Sparkline';
import { Avatar, AppText, Card, FadeInView, IconButton, Screen } from '@/presentation/components/ui';
import { useCrew } from '@/presentation/hooks/useCrew';

/**
 * Conectividad: estado REAL de la red del teléfono (expo-network) + métricas de enlace SIMULADAS
 * (intensidad, latencia con la Tierra) y tripulantes cercanos detectados por la red local de la estación.
 */
interface Peer {
  member: CrewMember;
  distanceM: number;
  rssi: number;
  angle: number;
}

const rnd = (min: number, max: number) => min + Math.random() * (max - min);
const quality = (dbm: number) => Math.max(0, Math.min(100, Math.round(((dbm + 95) / 50) * 100)));
const bars = (dbm: number) => (dbm >= -55 ? 4 : dbm >= -67 ? 3 : dbm >= -75 ? 2 : dbm >= -85 ? 1 : 0);

export default function ConnectivityScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const net = Network.useNetworkState();
  const online = !!net.isConnected && net.isInternetReachable !== false;
  const { others } = useCrew();
  const [ip, setIp] = useState<string | null>(null);
  const [dbm, setDbm] = useState(-58);
  const [history, setHistory] = useState<number[]>([]);
  const [latency, setLatency] = useState(1300);
  const [peers, setPeers] = useState<Peer[]>([]);
  const dbmRef = useRef(-58);
  const othersRef = useRef(others);
  useEffect(() => {
    othersRef.current = others;
  }, [others]);

  useEffect(() => {
    Network.getIpAddressAsync().then(setIp).catch(() => setIp(null));
  }, [net.type]);

  // Simulación en vivo cada segundo.
  useEffect(() => {
    const tick = () => {
      const next = Math.max(-92, Math.min(-42, Math.round(dbmRef.current + rnd(-3, 3))));
      dbmRef.current = next;
      setDbm(next);
      setHistory((h) => [...h, quality(next)].slice(-30));
      setLatency(Math.round(rnd(1250, 1420)));
      setPeers((cur) => {
        // Tripulantes cercanos: aparecen al detectar la red local.
        const base = cur.length ? cur : othersRef.current.map((m, i, all) => ({ member: m, distanceM: +rnd(3, 18).toFixed(1), rssi: -60, angle: (i / all.length) * Math.PI * 2 + 0.6 }));
        return base.map((p) => ({
          ...p,
          distanceM: Math.max(1, +(p.distanceM + rnd(-0.6, 0.6)).toFixed(1)),
          rssi: Math.round(-40 - p.distanceM * 1.8 + rnd(-2, 2)),
          angle: p.angle + rnd(-0.08, 0.08),
        }));
      });
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);


  const typeLabel = net.type ? t(`connectivityScreen.types.${typeKey(net.type)}`) : '…';
  const b = bars(dbm);

  return (
    <Screen>
      <FadeInView style={[styles.row, { gap: spacing.md }]}>
        <IconButton icon="arrow-back" tone="filled" accessibilityLabel={t('common.back')} onPress={() => router.back()} />
        <AppText variant="h1" style={styles.flex}>{t('connectivityScreen.title')}</AppText>
      </FadeInView>

      {/* Estado real del teléfono */}
      <FadeInView index={1}>
        <Card tone="night" style={{ gap: spacing.lg }}>
          <View style={[styles.row, { gap: spacing.md }]}>
            <View style={[styles.bigIcon, { backgroundColor: online ? colors.primary : colors.nightChip }]}>
              <Ionicons name={online ? 'wifi' : 'cloud-offline-outline'} size={30} color={online ? '#13201A' : colors.onNightMuted} />
            </View>
            <View style={styles.flex}>
              <AppText variant="h3" style={{ color: colors.onNight }}>{online ? t('nav.online') : t('nav.offline')}</AppText>
              <AppText variant="bodySmall" style={{ color: colors.onNightMuted }}>{typeLabel}{ip ? ` · ${ip}` : ''}</AppText>
            </View>
            <SignalBars level={b} color={colors.primary} track={colors.nightChip} />
          </View>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <Metric label={t('connectivityScreen.signal')} value={`${dbm} dBm`} />
            <Metric label={t('connectivityScreen.quality')} value={`${quality(dbm)} %`} />
            <Metric label={t('connectivityScreen.earthDelay')} value={`${(latency / 1000).toFixed(2)} s`} />
          </View>
          <View style={{ gap: spacing.xs }}>
            <AppText variant="caption" style={{ color: colors.onNightMuted }}>{t('connectivityScreen.live')}</AppText>
            <Sparkline data={history.length > 1 ? history : [50, 51]} width={280} height={56} />
          </View>
        </Card>
      </FadeInView>

      {/* Cómo funciona */}
      <FadeInView index={2}>
        <Card style={{ gap: spacing.md }}>
          <AppText variant="h3">{t('connectivityScreen.howTitle')}</AppText>
          {(['phone', 'station', 'relay', 'earth'] as const).map((k, i, arr) => (
            <View key={k} style={[styles.row, { gap: spacing.md, alignItems: 'flex-start' }]}>
              <View style={styles.center}>
                <View style={[styles.stepIcon, { backgroundColor: colors.surfaceTinted, borderRadius: radius.md }]}>
                  <Ionicons name={HOW_ICONS[k]} size={20} color={colors.primaryText} />
                </View>
                {i < arr.length - 1 && <View style={[styles.stepLine, { backgroundColor: colors.border }]} />}
              </View>
              <View style={[styles.flex, { paddingBottom: spacing.sm }]}>
                <AppText variant="title">{t(`connectivityScreen.how.${k}.title`)}</AppText>
                <AppText variant="bodySmall" color="textSecondary">{t(`connectivityScreen.how.${k}.body`)}</AppText>
              </View>
            </View>
          ))}
          <AppText variant="caption" color="textMuted">{t('connectivityScreen.offlineNote')}</AppText>
        </Card>
      </FadeInView>

      {/* Tripulantes cercanos */}
      <FadeInView index={3}>
        <Card style={{ gap: spacing.lg }}>
          <View style={[styles.row, { gap: spacing.sm }]}>
            <AppText variant="h3" style={styles.flex}>{t('connectivityScreen.nearby')}</AppText>
            <AppText variant="label" color="primaryText">{t('connectivityScreen.activeCount', { count: peers.length })}</AppText>
          </View>
          <RadarView peers={peers} />
          {peers.map((p) => (
            <View key={p.member.id} style={[styles.row, { gap: spacing.md }]}>
              <Avatar name={p.member.displayName} size={40} />
              <View style={styles.flex}>
                <AppText variant="title">{p.member.displayName}</AppText>
                <AppText variant="caption" color="textSecondary">
                  {t('crew.module', { module: p.member.module })} · {p.distanceM} m
                </AppText>
              </View>
              <View style={styles.center}>
                <SignalBars level={bars(p.rssi)} color={colors.primaryText} track={colors.progressTrack} small />
                <AppText variant="caption" color="textMuted">{p.rssi} dBm</AppText>
              </View>
            </View>
          ))}
        </Card>
      </FadeInView>
    </Screen>
  );
}

const HOW_ICONS = { phone: 'phone-portrait-outline', station: 'git-network-outline', relay: 'planet-outline', earth: 'earth-outline' } as const;

function typeKey(type: Network.NetworkStateType) {
  switch (type) {
    case Network.NetworkStateType.WIFI:
      return 'wifi';
    case Network.NetworkStateType.CELLULAR:
      return 'cellular';
    case Network.NetworkStateType.NONE:
      return 'none';
    default:
      return 'other';
  }
}

function Metric({ label, value }: { label: string; value: string }) {
  const { colors, spacing, radius } = useAppTheme();
  return (
    <View style={[styles.flex, { padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.nightChip }]}>
      <AppText variant="title" style={{ color: colors.onNight, fontVariant: ['tabular-nums'] }}>{value}</AppText>
      <AppText variant="caption" style={{ color: colors.onNightMuted }}>{label}</AppText>
    </View>
  );
}

function SignalBars({ level, color, track, small }: { level: number; color: string; track: string; small?: boolean }) {
  const h = small ? 14 : 26;
  return (
    <View style={[styles.row, { gap: small ? 2 : 3, alignItems: 'flex-end', height: h }]}>
      {[1, 2, 3, 4].map((i) => (
        <View key={i} style={{ width: small ? 4 : 6, height: (h * i) / 4, borderRadius: 2, backgroundColor: i <= level ? color : track }} />
      ))}
    </View>
  );
}

const RADAR = 240;

/** Radar de proximidad: barrido giratorio y tripulantes como puntos. */
function RadarView({ peers }: { peers: Peer[] }) {
  const { colors } = useAppTheme();
  const sweep = useSharedValue(0);
  useEffect(() => {
    sweep.value = withRepeat(withTiming(360, { duration: 3200, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(sweep);
  }, [sweep]);
  const sweepStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${sweep.value}deg` }] }));
  const c = RADAR / 2;
  const maxD = 20;

  return (
    <View style={[styles.center, { alignSelf: 'center', width: RADAR, height: RADAR }]}>
      <Svg width={RADAR} height={RADAR} style={StyleSheet.absoluteFill}>
        {[0.33, 0.66, 1].map((f) => (
          <Circle key={f} cx={c} cy={c} r={(c - 4) * f} stroke={colors.status.normal.ring} strokeWidth={1} fill="none" />
        ))}
        <Line x1={c} y1={4} x2={c} y2={RADAR - 4} stroke={colors.border} />
        <Line x1={4} y1={c} x2={RADAR - 4} y2={c} stroke={colors.border} />
        {peers.map((p) => {
          const r = Math.min(p.distanceM / maxD, 1) * (c - 12);
          return <Circle key={p.member.id} cx={c + Math.cos(p.angle) * r} cy={c + Math.sin(p.angle) * r} r={7} fill={colors.primary} stroke="#FFFFFF" strokeWidth={2} />;
        })}
        <Circle cx={c} cy={c} r={6} fill={colors.night} />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, sweepStyle]} pointerEvents="none">
        <View style={[styles.sweep, { left: c - 1, height: c - 4, top: 4, backgroundColor: colors.primary }]} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  bigIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  stepIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepLine: { width: 2, flex: 1, minHeight: 16, marginTop: 4 },
  sweep: { position: 'absolute', width: 2, opacity: 0.7 },
});
