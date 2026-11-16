import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppTheme } from '@/core/theme';
import { PressableScale } from './PressableScale';

export interface IconButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  accessibilityLabel: string;
  onPress?: () => void;
  /** 'plain' = sin fondo; 'filled' = círculo de superficie; 'onHero' = sobre tarjeta salvia. */
  tone?: 'plain' | 'filled' | 'onHero';
}

export function IconButton({ icon, accessibilityLabel, onPress, tone = 'plain' }: IconButtonProps) {
  const { colors, radius, hitSize } = useAppTheme();
  const bg = tone === 'filled' ? colors.surface : tone === 'onHero' ? colors.onHero : 'transparent';
  const fg = tone === 'onHero' ? colors.hero : colors.text;
  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={{ width: hitSize - 8, height: hitSize - 8, borderRadius: radius.pill, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <Ionicons name={icon} size={20} color={fg} />
    </PressableScale>
  );
}
