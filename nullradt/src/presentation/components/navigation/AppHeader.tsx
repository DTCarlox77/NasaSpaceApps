import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNetworkState } from 'expo-network';
import { router } from 'expo-router';
import { useTriageStore } from '@/presentation/store/triageStore';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { BrandMark } from '../brand/BrandMark';
import { AppText } from '../ui/AppText';
import { Avatar } from '../ui/Avatar';
import { useAuthStore } from '@/presentation/store/authStore';
import { PressableScale } from '../ui/PressableScale';

/**
 * Encabezado global oscuro (Figma, móvil): isotipo a la izquierda;
 * a la derecha SOS, estado del enlace con la Tierra, notificaciones y perfil.
 */
export function AppHeader() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const insets = useSafeAreaInsets();
  const net = useNetworkState();
  const online = !!net.isConnected && net.isInternetReachable !== false;
  const name = useAuthStore((s) => s.session?.displayName ?? '');

  return (
    <View style={{ backgroundColor: colors.night, paddingTop: insets.top }}>
      <StatusBar style="light" />
      <View style={[styles.row, { height: 64, paddingHorizontal: spacing.lg, gap: spacing.sm }]}>
        <BrandMark size={40} />
        <View style={styles.flex} />

        <PressableScale
          accessibilityLabel={t('alert.open')}
          onPress={() => (useTriageStore.getState().active ? router.push('/triage') : router.push({ pathname: '/alert', params: { trigger: 'manual' } }))}
          style={[styles.row, styles.sos, { backgroundColor: colors.dangerStrong, borderRadius: radius.pill, paddingHorizontal: spacing.md, gap: spacing.xs }]}
        >
          <MaterialCommunityIcons name="alarm-light-outline" size={18} color="#FFFFFF" />
          <AppText variant="button" style={{ color: '#FFFFFF', fontSize: 14 }}>{t('nav.sos')}</AppText>
        </PressableScale>

        <PressableScale
          accessibilityLabel={online ? t('nav.online') : t('nav.offline')}
          onPress={() => router.push('/connectivity')}
          style={[styles.iconBtn, { backgroundColor: colors.nightChip, borderColor: 'rgba(255,255,255,0.1)' }]}
        >
          <Ionicons name={online ? 'wifi' : 'cloud-offline-outline'} size={18} color={online ? colors.primary : colors.onNightMuted} />
        </PressableScale>

        <HeaderButton icon="notifications-outline" label={t('common.notifications')} onPress={() => router.push('/notifications-lab')} />
        <PressableScale accessibilityLabel={t('common.profile')} onPress={() => router.push('/profile')} style={[styles.avatarBtn, { borderColor: 'rgba(255,255,255,0.15)' }]}>
          <Avatar name={name} size={36} tone="night" />
        </PressableScale>
      </View>
    </View>
  );
}

function HeaderButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <PressableScale
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.iconBtn, { backgroundColor: colors.nightChip, borderColor: 'rgba(255,255,255,0.1)' }]}
    >
      <Ionicons name={icon} size={20} color={colors.onNight} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  sos: {
    height: 40,
    shadowColor: '#C2372F',
    shadowOpacity: 0.55,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  avatarBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
