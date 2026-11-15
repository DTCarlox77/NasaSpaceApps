import { useState } from 'react';
import { Animated, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { MaterialTopTabBarProps } from 'expo-router/js-top-tabs';
import { useAppTheme } from '@/core/theme';
import { AppText } from '../ui/AppText';
import { PressableScale } from '../ui/PressableScale';

export type TabIconName = keyof typeof Ionicons.glyphMap;

/** Íconos por ruta: [activo, inactivo]. */
/** Íconos por ruta (Figma: layout-dashboard, activity, bell-ring, heart-handshake, ellipsis): [activo, inactivo]. */
export const TAB_ICONS: Record<string, [TabIconName, TabIconName]> = {
  index: ['grid', 'grid-outline'],
  body: ['pulse', 'pulse-outline'],
  routine: ['alarm', 'alarm-outline'],
  wellbeing: ['heart', 'heart-outline'],
  more: ['ellipsis-horizontal-circle', 'ellipsis-horizontal-circle-outline'],
};

/** Figma: el ícono va dentro de una pastilla de 48×28 (brand-100 cuando está activa). */
const PILL_WIDTH = 48;

/**
 * Barra inferior para el navegador deslizable.
 * El indicador (pastilla detrás del ícono) sigue `position` del pager,
 * así se mueve en tiempo real mientras el usuario desliza entre pestañas.
 */
export function SwipeTabBar({ state, descriptors, position, jumpTo, insets }: MaterialTopTabBarProps) {
  const { colors, spacing, radius } = useAppTheme();
  const [width, setWidth] = useState(0);
  const count = state.routes.length;
  const tabWidth = width / count;

  const translateX =
    count > 1
      ? position.interpolate({
          inputRange: state.routes.map((_, i) => i),
          outputRange: state.routes.map((_, i) => i * tabWidth + (tabWidth - PILL_WIDTH) / 2),
          extrapolate: 'clamp',
        })
      : (tabWidth - PILL_WIDTH) / 2;

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, spacing.sm),
          paddingTop: spacing.sm,
        },
      ]}
    >
      <View style={styles.row} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pill,
              { width: PILL_WIDTH, borderRadius: radius.pill, backgroundColor: colors.primarySoft, transform: [{ translateX }] },
            ]}
          />
        )}
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const { options } = descriptors[route.key];
          const label = typeof options.title === 'string' ? options.title : route.name;
          const [active, inactive] = TAB_ICONS[route.name] ?? ['ellipse', 'ellipse-outline'];
          const color = focused ? colors.primaryText : colors.tabIconInactive;

          return (
            <PressableScale
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              onPress={() => {
                if (!focused) jumpTo(route.key);
              }}
              style={styles.tab}
            >
              <View style={styles.iconBox}>
                <Ionicons name={focused ? active : inactive} size={22} color={color} />
              </View>
              <AppText variant="label" numberOfLines={1} style={{ color, fontSize: 12, marginTop: spacing.xxs }}>
                {label}
              </AppText>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row' },
  pill: { position: 'absolute', top: 2, left: 0, height: 28 },
  tab: { flex: 1, alignItems: 'center', minHeight: 48 },
  iconBox: { height: 32, alignItems: 'center', justifyContent: 'center' },
});
