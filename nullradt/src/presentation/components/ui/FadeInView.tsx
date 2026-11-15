import type { PropsWithChildren } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { Easing, FadeInDown } from 'react-native-reanimated';
import { motion } from '@/core/theme';

export interface FadeInViewProps extends PropsWithChildren {
  /** Posición en una lista: genera entrada escalonada. */
  index?: number;
  style?: StyleProp<ViewStyle>;
}

/** Entrada suave (aparece y sube 6px, como el `fade-up` del Figma). Sin resorte: no rebota. */
export function FadeInView({ index = 0, style, children }: FadeInViewProps) {
  return (
    <Animated.View
      entering={FadeInDown.delay(index * motion.stagger)
        .duration(320)
        .easing(Easing.bezier(0.2, 0.7, 0.2, 1))
        .withInitialValues({ transform: [{ translateY: 6 }] })}
      style={style}
    >
      {children}
    </Animated.View>
  );
}
