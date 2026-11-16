import { StyleSheet, View } from 'react-native';
import { TopTabs } from 'expo-router/js-top-tabs';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppHeader } from '@/presentation/components/navigation/AppHeader';
import { SwipeTabBar } from '@/presentation/components/navigation/SwipeTabBar';

/**
 * Navegación principal (Figma, móvil): encabezado oscuro global + 5 pestañas deslizables
 * Inicio · Monitor · Rutina · Bienestar · Más.
 */
export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors } = useAppTheme();

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <AppHeader />
      <TopTabs
        tabBarPosition="bottom"
        tabBar={(props) => <SwipeTabBar {...props} />}
        screenOptions={{ swipeEnabled: true, lazy: true, lazyPreloadDistance: 1, sceneStyle: { backgroundColor: colors.background } }}
      >
        <TopTabs.Screen name="index" options={{ title: t('tabs.home') }} />
        <TopTabs.Screen name="body" options={{ title: t('tabs.monitor') }} />
        <TopTabs.Screen name="routine" options={{ title: t('tabs.routine') }} />
        <TopTabs.Screen name="wellbeing" options={{ title: t('tabs.wellbeing') }} />
        <TopTabs.Screen name="more" options={{ title: t('tabs.more') }} />
      </TopTabs>
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
