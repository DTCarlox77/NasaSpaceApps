import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import { AppText } from '../ui/AppText';
import { FadeInView } from '../ui/FadeInView';
import { Screen } from '../ui/Screen';

interface Props {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
}

/** Pantalla temporal para módulos aún no construidos. */
export function PlaceholderScreen({ title, subtitle, icon }: Props) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useAppTheme();
  const float = useSharedValue(0);

  useEffect(() => {
    float.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [float]);

  const floatStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -8 * float.value }] }));

  return (
    <Screen topInset={false}>
      <FadeInView>
        <AppText variant="h1">{title}</AppText>
        <AppText color="textSecondary">{subtitle}</AppText>
      </FadeInView>
      <FadeInView index={1}>
        <View style={[styles.box, { backgroundColor: colors.surfaceTinted, borderRadius: radius.xl, padding: spacing.huge, gap: spacing.lg }]}>
          <Animated.View style={floatStyle}>
            <Ionicons name={icon} size={88} color={colors.primaryText} />
          </Animated.View>
          <AppText variant="title" color="textSecondary">{t('common.comingSoon')}</AppText>
        </View>
      </FadeInView>
    </Screen>
  );
}

const styles = StyleSheet.create({ box: { alignItems: 'center' } });
