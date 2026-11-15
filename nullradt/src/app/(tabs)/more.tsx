import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppText, FadeInView, PressableScale, Screen } from '@/presentation/components/ui';
import { apiEnabled } from '@/core/config/env';
import { showToast } from '@/presentation/store/toastStore';
import { useSyncStore } from '@/presentation/store/syncStore';
import { runSync } from '@/presentation/sync/syncEngine';

type TileKey = 'tests' | 'crew' | 'connectivity' | 'measure' | 'history' | 'triage' | 'achievements' | 'profile' | 'settings' | 'sync' | 'voiceLab' | 'notificationsLab';

interface Tile {
  key: TileKey;
  icon: keyof typeof Ionicons.glyphMap;
  href?: Href;
  danger?: boolean;
}

/** "Más" (Figma: hoja con accesos en 2 columnas). Triaje en tono crítico. */
const TILES: Tile[] = [
  { key: 'tests', icon: 'flash-outline', href: '/tests' as Href },
  { key: 'crew', icon: 'people-outline', href: '/crew' },
  { key: 'measure', icon: 'pulse-outline', href: { pathname: '/measure', params: { indicator: 'bloodPressure' } } },
  { key: 'connectivity', icon: 'wifi-outline', href: '/connectivity' },
  { key: 'history', icon: 'time-outline' },
  { key: 'triage', icon: 'medkit-outline', href: { pathname: '/alert', params: { trigger: 'manual' } }, danger: true },
  { key: 'achievements', icon: 'trophy-outline' },
  { key: 'profile', icon: 'person-circle-outline', href: '/profile' },
  { key: 'settings', icon: 'settings-outline', href: '/settings' },
  { key: 'sync', icon: 'sync-outline' },
  { key: 'voiceLab', icon: 'mic-outline', href: '/voice-lab' },
  { key: 'notificationsLab', icon: 'notifications-outline', href: '/notifications-lab' },
];

export default function MoreScreen() {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();

  /** Sincroniza la cola offline con el servidor (POST /sync/push + GET /sync/pull). */
  const syncNow = () =>
    runSync().then(() => {
      const pending = useSyncStore.getState().pending;
      showToast({
        level: pending ? 'caution' : 'normal',
        title: t('more.items.sync'),
        body: pending ? t('sync.pendingBody', { count: pending }) : t('sync.doneBody'),
      });
    });

  return (
    <Screen topInset={false}>
      <FadeInView>
        <AppText variant="h1">{t('more.title')}</AppText>
      </FadeInView>
      <View style={[styles.grid, { gap: spacing.md }]}>
        {TILES.map((tile, i) => {
          const fg = tile.danger ? colors.status.critical.text : colors.text;
          return (
            <FadeInView key={tile.key} index={i + 1} style={styles.item}>
              <PressableScale
                accessibilityLabel={t(`more.items.${tile.key}`)}
                onPress={() =>
                  tile.href
                    ? router.push(tile.href)
                    : tile.key === 'sync' && apiEnabled()
                      ? syncNow()
                      : showToast({ level: 'info', title: t(`more.items.${tile.key}`), body: t('common.comingSoon') })
                }
                style={[
                  styles.tile,
                  {
                    gap: spacing.sm,
                    padding: spacing.lg,
                    borderRadius: radius.button,
                    backgroundColor: tile.danger ? colors.status.critical.background : colors.surfaceAlt,
                    borderColor: tile.danger ? colors.status.critical.ring : colors.border,
                  },
                ]}
              >
                <Ionicons name={tile.icon} size={24} color={tile.danger ? colors.status.critical.solid : colors.primaryText} />
                <AppText variant="title" style={{ color: fg }} numberOfLines={2}>{t(`more.items.${tile.key}`)}</AppText>
              </PressableScale>
            </FadeInView>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  item: { flexBasis: '45%', flexGrow: 1 },
  tile: { minHeight: 96, borderWidth: 1, justifyContent: 'space-between' },
});
