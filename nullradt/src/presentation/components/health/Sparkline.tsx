import Svg, { Circle, Path } from 'react-native-svg';
import { useAppTheme } from '@/core/theme';

/** Mini-gráfica de tendencia (Figma: trazo salvia 2px con punto final). */
export function Sparkline({ data, width = 96, height = 32 }: { data: number[]; width?: number; height?: number }) {
  const { colors } = useAppTheme();
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 4;
  const pts = data.map((v, i) => [
    pad + (i / (data.length - 1)) * (width - pad * 2),
    pad + (1 - (v - min) / span) * (height - pad * 2),
  ]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x!.toFixed(1)} ${y!.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1]!;
  return (
    <Svg width={width} height={height} accessible={false}>
      <Path d={d} fill="none" stroke={colors.tertiary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={lx} cy={ly} r={3.5} fill={colors.tertiary} />
    </Svg>
  );
}
