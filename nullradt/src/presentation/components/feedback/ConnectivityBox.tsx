import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNetworkState } from 'expo-network';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppText } from '../ui/AppText';

/** Estado del enlace con la Tierra (Figma: caja de conectividad del login). Offline-first: sin red todo sigue funcionando. */
export function ConnectivityBox() {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useAppTheme();
  const net = useNetworkState();
  const online = !!net.isConnected && net.isInternetReachable !== false;

  return (
    <View style={[styles.row, { gap: spacing.md, padding: spacing.lg, borderRadius: radius.button, backgroundColor: colors.surfaceAlt }]}>
      <View style={[styles.tile, { borderRadius: radius.md, backgroundColor: colors.surface }]}>
        <Ionicons name={online ? 'wifi' : 'cloud-offline-outline'} size={18} color={colors.textSecondary} />
      </View>
      <View style={styles.flex}>
        <AppText variant="label">{online ? t('connectivity.onlineTitle') : t('connectivity.offlineTitle')}</AppText>
        <AppText variant="bodySmall" color="textSecondary">{online ? t('connectivity.onlineBody') : t('connectivity.offlineBody')}</AppText>
      </View>
      <Ionicons name="planet-outline" size={22} color={colors.tertiary} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  tile: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
