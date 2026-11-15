import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAppTheme } from '@/core/theme';

export interface ScreenProps extends PropsWithChildren {
  /**
   * `true` (por defecto) = pantalla independiente: respeta el área segura superior y fija la barra de estado.
   * `false` = pantalla dentro de las pestañas: el encabezado oscuro global ya ocupa la parte superior.
   */
  topInset?: boolean;
}

/** Contenedor de pantalla: fondo del tema, safe area y scroll. */
export function Screen({ children, topInset = true }: ScreenProps) {
  const { colors, spacing, isDark } = useAppTheme();
  const edges: Edge[] = topInset ? ['top', 'left', 'right'] : ['left', 'right'];
  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: colors.background }]}>
      {topInset && <StatusBar style={isDark ? 'light' : 'dark'} />}
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.huge, gap: spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
