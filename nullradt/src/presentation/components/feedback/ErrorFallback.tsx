import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import i18n from '@/core/i18n';
import { useAppTheme } from '@/core/theme';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';

/** Vista amable de error: muestra el mensaje (para reportarlo) y permite reintentar o volver. */
export function ErrorFallbackView({ error, onRetry, onBack }: { error: Error; onRetry?: () => void; onBack?: () => void }) {
  const { colors, spacing, radius } = useAppTheme();
  return (
    <View style={[styles.box, { gap: spacing.md, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.status.caution.background, borderColor: colors.status.caution.ring }]}>
      <Ionicons name="warning-outline" size={32} color={colors.accent} />
      <AppText variant="h3" align="center">{i18n.t('errors.viewTitle')}</AppText>
      <AppText variant="bodySmall" color="textSecondary" align="center">{i18n.t('errors.viewBody')}</AppText>
      <AppText variant="caption" selectable style={{ color: colors.accentText, fontFamily: 'monospace' }}>
        {error.name}: {error.message}
      </AppText>
      <View style={[styles.row, { gap: spacing.sm }]}>
        {onRetry && <Button label={i18n.t('errors.retry')} size="sm" leftIcon="refresh" onPress={onRetry} />}
        {onBack && <Button label={i18n.t('common.back')} size="sm" variant="outline" leftIcon="arrow-back" onPress={onBack} />}
      </View>
    </View>
  );
}

/** Límite de error para secciones pesadas (p. ej. el visor 3D): si fallan, el resto de la pantalla sigue funcionando. */
export class SectionErrorBoundary extends Component<{ children: ReactNode; onBack?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[NullRadt] Error en sección:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <ErrorFallbackView error={this.state.error} onRetry={() => this.setState({ error: null })} onBack={this.props.onBack} />;
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', borderWidth: 1, margin: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
});
