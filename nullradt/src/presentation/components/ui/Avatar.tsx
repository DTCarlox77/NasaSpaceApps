import { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useAppTheme } from '@/core/theme';
import { useProfileStore } from '@/presentation/store/profileStore';
import { AppText } from './AppText';

export const initialsOf = (name: string) =>
  name
    .replace(/[^A-Za-zÀ-ÿ0-9 -]/g, '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** Avatar (Figma): foto de perfil si existe; si no, iniciales sobre brand-100. */
export function Avatar({ name, size = 44, tone = 'brand' }: { name: string; size?: number; tone?: 'brand' | 'night' }) {
  const { colors } = useAppTheme();
  const { photoUri, load } = useProfileStore();

  useEffect(() => {
    load();
  }, [load]);

  const style = { width: size, height: size, borderRadius: size / 2 };
  if (photoUri) {
    return <Image source={{ uri: photoUri }} style={[style, styles.img]} accessibilityLabel={name} />;
  }
  return (
    <View
      accessibilityLabel={name}
      style={[style, styles.center, { backgroundColor: tone === 'night' ? colors.night : colors.primarySoft }]}
    >
      {/* La altura de línea debe crecer con la letra; si no, Lexend se corta arriba y abajo. */}
      <AppText
        variant="title"
        numberOfLines={1}
        style={{ color: tone === 'night' ? colors.primary : colors.primaryText, fontSize: size * 0.36, lineHeight: Math.round(size * 0.36 * 1.3), includeFontPadding: false, textAlignVertical: 'center' }}
      >
        {initialsOf(name)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  img: { backgroundColor: '#E2E9E4' },
});
