import { useEffect, useRef, type ComponentRef, type PropsWithChildren } from 'react';
import { Dimensions, Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet, TextInput } from 'react-native';
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

/** Margen entre el campo enfocado y el borde superior del teclado. */
const KEYBOARD_GAP = 24;

/**
 * Contenedor de pantalla: fondo del tema, safe area y scroll.
 * Evita el teclado: deja espacio debajo y, al abrirse, desplaza el campo enfocado para que no quede tapado
 * (en Android edge-to-edge la ventana no se redimensiona sola).
 */
export function Screen({ children, topInset = true }: ScreenProps) {
  const { colors, spacing, isDark } = useAppTheme();
  const edges: Edge[] = topInset ? ['top', 'left', 'right'] : ['left', 'right'];
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const offset = useRef(0);

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', (e) => {
      const input = TextInput.State.currentlyFocusedInput();
      if (!input || !scrollRef.current) return;
      input.measureInWindow((_x, y, _w, h) => {
        const keyboardTop = Dimensions.get('window').height - e.endCoordinates.height;
        const overlap = y + h + KEYBOARD_GAP - keyboardTop;
        if (overlap > 0) scrollRef.current?.scrollTo({ y: offset.current + overlap, animated: true });
      });
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaView edges={edges} style={[styles.flex, { backgroundColor: colors.background }]}>
      {topInset && <StatusBar style={isDark ? 'light' : 'dark'} />}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView
          ref={scrollRef}
          onScroll={(e) => {
            offset.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={32}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.huge, gap: spacing.xl }}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
