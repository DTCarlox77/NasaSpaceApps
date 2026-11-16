import { memo, useEffect, type ReactNode } from 'react';
import Animated, { Easing, useAnimatedProps, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '@/core/theme';
import type { BodySystemId, HealthStatus } from '@/domain/entities/HealthIndicator';

/**
 * Mapa corporal interactivo — geometría portada del diseño en Figma (viewBox 300×610).
 * Cambios respecto al Figma: piel y halo con colores planos (sin degradados) y paleta para modo oscuro.
 */

type Pt = [number, number];
const START: Pt = [150, 92];
/** Mitad izquierda de la silueta en curvas cúbicas; la derecha se obtiene reflejando sobre x=150. */
const SEGMENTS: [Pt, Pt, Pt][] = [
  [[144, 92], [139, 94], [138, 98]], [[138, 104], [137, 110], [134, 114]], [[120, 122], [100, 124], [90, 134]],
  [[76, 144], [72, 166], [72, 190]], [[70, 215], [66, 240], [64, 262]], [[60, 290], [56, 320], [56, 342]],
  [[52, 360], [52, 384], [64, 390]], [[74, 394], [80, 382], [80, 366]], [[80, 354], [82, 346], [84, 340]],
  [[88, 310], [92, 286], [94, 266]], [[96, 240], [98, 200], [104, 176]], [[106, 210], [110, 250], [110, 276]],
  [[108, 296], [102, 312], [102, 332]], [[102, 380], [108, 420], [110, 452]], [[110, 470], [106, 490], [108, 520]],
  [[110, 545], [116, 560], [118, 568]], [[112, 576], [104, 584], [108, 590]], [[118, 594], [136, 594], [140, 586]],
  [[142, 578], [140, 570], [140, 560]], [[144, 530], [142, 500], [142, 468]], [[142, 440], [146, 400], [146, 370]],
  [[147, 358], [149, 352], [150, 350]],
];
const mirror = ([x, y]: Pt): Pt => [300 - x, y];
const SILHOUETTE = (() => {
  let d = `M${START}`;
  for (const [a, b, c] of SEGMENTS) d += ` C${a} ${b} ${c}`;
  const ends = [START, ...SEGMENTS.map((s) => s[2])];
  for (let i = SEGMENTS.length - 1; i >= 0; i--) d += ` C${mirror(SEGMENTS[i]![1])} ${mirror(SEGMENTS[i]![0])} ${mirror(ends[i]!)}`;
  return `${d} Z`;
})();

interface ZoneColors {
  fill: string;
  stroke: string;
  detail: string;
}

const LIGHT_ZONE: Record<HealthStatus, ZoneColors> = {
  normal: { fill: '#C9F3D9', stroke: '#2FB866', detail: '#1D8A4B' },
  caution: { fill: '#FAE0D1', stroke: '#DE7C49', detail: '#96451A' },
  critical: { fill: '#F9D6D3', stroke: '#DE5149', detail: '#A52A23' },
  unevaluated: { fill: '#E4E9E6', stroke: '#8A968F', detail: '#4C5852' },
};
const DARK_ZONE: Record<HealthStatus, ZoneColors> = {
  normal: { fill: '#1E4630', stroke: '#4ADD82', detail: '#82E6A8' },
  caution: { fill: '#4A2E1F', stroke: '#DE7C49', detail: '#EBA57F' },
  critical: { fill: '#4A2220', stroke: '#DE5149', detail: '#EA8780' },
  unevaluated: { fill: '#2A3330', stroke: '#8A968F', detail: '#B9C4BE' },
};
const MARKER_HEX: Record<HealthStatus, string> = { normal: '#4ADD82', caution: '#DE7C49', critical: '#DE5149', unevaluated: '#8A968F' };

const LUNG_L = 'M143 140 C130 134 117 146 113 168 C109 192 110 214 117 226 C125 233 137 229 143 221 C145 200 145 170 143 140 Z';
const LUNG_R = 'M157 140 C170 134 183 146 187 168 C191 192 190 214 183 226 C177 230 170 228 166 222 C164 214 160 208 157 204 C155 182 155 160 157 140 Z';

interface Zone {
  id: BodySystemId;
  marker: Pt;
  /** [cx, cy, rx, ry] áreas táctiles. */
  hits: [number, number, number, number][];
  draw: (c: ZoneColors) => ReactNode;
}

const ZONES: Zone[] = [
  {
    id: 'brain', marker: [176, 30], hits: [[150, 42, 28, 22]],
    draw: (c) => (
      <G>
        <Path d="M150 25 C134 24 124 34 125 46 C126 56 134 62 150 62 C166 62 174 56 175 46 C176 34 166 24 150 25 Z" fill={c.fill} stroke={c.stroke} strokeWidth={1.6} />
        <Path d="M150 26 V61 M136 34 C140 38 138 44 132 46 M140 52 C144 50 146 54 145 58 M164 34 C160 38 162 44 168 46 M160 52 C156 50 154 54 155 58" fill="none" stroke={c.detail} strokeWidth={1.2} strokeLinecap="round" opacity={0.55} />
      </G>
    ),
  },
  {
    id: 'eyes', marker: [178, 66], hits: [[150, 68, 24, 9]],
    draw: (c) => (
      <G>
        {[138, 162].map((x) => (
          <G key={x}>
            <Ellipse cx={x} cy={68} rx={7} ry={4} fill="#FFFFFF" stroke={c.stroke} strokeWidth={1.4} />
            <Circle cx={x} cy={68} r={2.6} fill={c.detail} />
          </G>
        ))}
      </G>
    ),
  },
  {
    id: 'respiratory', marker: [120, 158], hits: [[128, 184, 18, 44], [172, 184, 18, 44]],
    draw: (c) => (
      <G>
        <Path d={LUNG_L} fill={c.fill} stroke={c.stroke} strokeWidth={1.6} />
        <Path d={LUNG_R} fill={c.fill} stroke={c.stroke} strokeWidth={1.6} />
        <Path d="M150 116 V134 M150 134 C146 138 142 142 138 152 M150 134 C154 138 158 142 162 152 M131 170 L124 184 M169 170 L176 184 M128 196 L122 208" fill="none" stroke={c.detail} strokeWidth={1.3} strokeLinecap="round" opacity={0.6} />
      </G>
    ),
  },
  {
    id: 'cardiovascular', marker: [174, 186], hits: [[160, 198, 16, 16]],
    draw: (c) => (
      <G>
        <Path d="M156 188 C150 180 139 184 141 196 C143 206 155 213 159 218 C164 212 176 204 176 193 C176 182 163 180 156 188 Z" fill={c.fill} stroke={c.stroke} strokeWidth={1.8} />
        <Path d="M153 186 C153 178 156 172 160 168 M161 185 C162 178 166 174 170 172" fill="none" stroke={c.stroke} strokeWidth={2.2} strokeLinecap="round" />
      </G>
    ),
  },
  {
    id: 'immune', marker: [150, 146],
    hits: [[150, 146, 9, 10], [138, 108, 7, 7], [162, 108, 7, 7], [108, 180, 7, 7], [192, 180, 7, 7], [128, 336, 8, 8], [172, 336, 8, 8], [180, 250, 9, 9]],
    draw: (c) => (
      <G>
        {([[138, 108], [162, 108], [108, 180], [192, 180], [128, 336], [172, 336]] as Pt[]).map(([x, y]) => (
          <G key={`${x}-${y}`}>
            <Circle cx={x} cy={y} r={4.5} fill={c.fill} stroke={c.stroke} strokeWidth={1.4} />
            <Circle cx={x} cy={y} r={1.4} fill={c.detail} />
          </G>
        ))}
        <Ellipse cx={180} cy={252} rx={7} ry={10} rotation={-20} originX={180} originY={252} fill={c.fill} stroke={c.stroke} strokeWidth={1.4} />
      </G>
    ),
  },
  {
    id: 'muscular', marker: [82, 196], hits: [[84, 210, 12, 30], [216, 210, 12, 30], [124, 398, 15, 38], [176, 398, 15, 38]],
    draw: (c) => (
      <G>
        {([[84, 210, 8.5, 26, 6], [216, 210, 8.5, 26, -6], [124, 398, 12, 36, -3], [176, 398, 12, 36, 3]] as const).map(([x, y, rx, ry, a]) => (
          <G key={x} rotation={a} originX={x} originY={y}>
            <Ellipse cx={x} cy={y} rx={rx} ry={ry} fill={c.fill} stroke={c.stroke} strokeWidth={1.4} />
            <Path d={`M${x} ${y - ry + 6} V${y + ry - 6}`} stroke={c.detail} strokeWidth={1} opacity={0.4} />
          </G>
        ))}
      </G>
    ),
  },
  {
    id: 'skeletal', marker: [186, 456], hits: [[150, 282, 10, 46], [150, 322, 40, 14], [126, 508, 10, 58], [174, 508, 10, 58]],
    draw: (c) => (
      <G>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Rect key={i} x={144} y={238 + i * 14} width={12} height={10} rx={3} fill={c.fill} stroke={c.stroke} strokeWidth={1.3} />
        ))}
        <Path d="M118 314 C124 304 138 306 146 320 L150 330 L154 320 C162 306 176 304 182 314 C184 330 172 342 160 342 L140 342 C128 342 116 330 118 314 Z" fill={c.fill} stroke={c.stroke} strokeWidth={1.4} />
        {[126, 174].map((x) => (
          <G key={x}>
            <Circle cx={x} cy={456} r={6.5} fill={c.fill} stroke={c.stroke} strokeWidth={1.4} />
            <Rect x={x - 3.5} y={466} width={7} height={92} rx={3.5} fill={c.fill} stroke={c.stroke} strokeWidth={1.3} />
          </G>
        ))}
      </G>
    ),
  },
];

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Marcador de estado del sistema (check, triángulo, octágono o círculo punteado) con pulso si está activo. */
function Marker({ at: [x, y], status, active }: { at: Pt; status: HealthStatus; active: boolean }) {
  const hex = MARKER_HEX[status];
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (active) pulse.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false);
    else pulse.value = 0;
  }, [active, pulse]);
  const ringProps = useAnimatedProps(() => ({ r: 9 + pulse.value * 9, opacity: active ? 0.55 * (1 - pulse.value) : 0 }));

  return (
    <G pointerEvents="none">
      <AnimatedCircle cx={x} cy={y} fill={hex} animatedProps={ringProps} />
      {status === 'normal' && (
        <>
          <Circle cx={x} cy={y} r={9} fill="#FFFFFF" stroke={hex} strokeWidth={2.4} />
          <Path d={`M${x - 4} ${y} l3 3 l5 -6`} fill="none" stroke="#14592F" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {status === 'caution' && (
        <>
          <Path d={`M${x} ${y - 11} L${x + 11} ${y + 8} L${x - 11} ${y + 8} Z`} fill="#FFFFFF" stroke={hex} strokeWidth={2.4} strokeLinejoin="round" />
          <Path d={`M${x} ${y - 4} V${y + 1}`} stroke="#96451A" strokeWidth={2.2} strokeLinecap="round" />
          <Circle cx={x} cy={y + 4.5} r={1.3} fill="#96451A" />
        </>
      )}
      {status === 'critical' && (
        <>
          <Path d={`M${x - 4.5} ${y - 10} h9 l6.5 6.5 v9 l-6.5 6.5 h-9 l-6.5 -6.5 v-9 Z`} fill={hex} stroke="#FFFFFF" strokeWidth={1.6} />
          <Path d={`M${x} ${y - 5} V${y + 1}`} stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" />
          <Circle cx={x} cy={y + 4.5} r={1.4} fill="#FFFFFF" />
        </>
      )}
      {status === 'unevaluated' && (
        <>
          <Circle cx={x} cy={y} r={9} fill="#FFFFFF" stroke={hex} strokeWidth={2.2} strokeDasharray="3 2.5" />
          <Circle cx={x} cy={y} r={2} fill="#4C5852" />
        </>
      )}
    </G>
  );
}

export interface BodyFigureProps {
  statuses: Record<BodySystemId, HealthStatus>;
  selected: BodySystemId | null;
  onSelect: (id: BodySystemId) => void;
  height?: number;
}

function BodyFigureImpl({ statuses, selected, onSelect, height = 440 }: BodyFigureProps) {
  const { t } = useTranslation();
  const { isDark, colors } = useAppTheme();
  const zonePalette = isDark ? DARK_ZONE : LIGHT_ZONE;
  const skin = isDark ? { fill: '#1E2924', stroke: '#3A4842', line: '#33413A' } : { fill: '#F4F9F6', stroke: '#BFCDC4', line: '#C9D4CD' };
  const selectedZone = ZONES.find((z) => z.id === selected);

  return (
    <Svg width="100%" height={height} viewBox="0 0 300 610" accessible={false}>
      {/* Fondo: halo y órbitas planas */}
      <Ellipse cx={150} cy={280} rx={140} ry={240} fill={colors.primarySoft} opacity={isDark ? 0.35 : 0.45} />
      <Ellipse cx={150} cy={300} rx={142} ry={60} fill="none" stroke={isDark ? '#2F5A40' : '#B4EFCB'} strokeWidth={1} strokeDasharray="2 6" rotation={-14} originX={150} originY={300} />
      <Ellipse cx={150} cy={300} rx={120} ry={210} fill="none" stroke={colors.border} strokeWidth={1} />
      <Circle cx={268} cy={240} r={3} fill={colors.primary} />

      {/* Silueta */}
      <Ellipse cx={150} cy={56} rx={32} ry={40} fill={skin.fill} stroke={skin.stroke} strokeWidth={1.6} />
      <Path d={SILHOUETTE} fill={skin.fill} stroke={skin.stroke} strokeWidth={1.6} strokeLinejoin="round" />
      <Ellipse cx={150} cy={56} rx={31} ry={39} fill={skin.fill} />
      <Path d="M110 128 C124 132 138 130 148 126 M190 128 C176 132 162 130 152 126 M150 238 V300 M120 452 C124 456 128 456 132 452 M168 452 C172 456 176 456 180 452" fill="none" stroke={skin.line} strokeWidth={1.2} strokeLinecap="round" />
      <Path d="M141 82 C146 85 154 85 159 82" fill="none" stroke={skin.stroke} strokeWidth={1.6} strokeLinecap="round" />

      {/* Zonas */}
      {ZONES.map((zone) => {
        const status = statuses[zone.id] ?? 'unevaluated';
        const isSelected = selected === zone.id;
        const dimmed = !!selected && !isSelected;
        return (
          <G key={zone.id} opacity={dimmed ? 0.42 : 1} onPress={() => onSelect(zone.id)}>
            {zone.hits.map(([cx, cy, rx, ry], i) => (
              <Ellipse key={i} cx={cx} cy={cy} rx={rx + 4} ry={ry + 4} fill="#000000" fillOpacity={0.001} />
            ))}
            {zone.draw(zonePalette[status])}
            {isSelected &&
              zone.hits.map(([cx, cy, rx, ry], i) => (
                <Ellipse key={`s${i}`} cx={cx} cy={cy} rx={rx + 5} ry={ry + 5} fill="none" stroke={colors.text} strokeWidth={1.5} strokeDasharray="4 3" />
              ))}
            <Marker at={zone.marker} status={status} active={isSelected} />
          </G>
        );
      })}

      {/* Etiqueta del sistema seleccionado */}
      {selectedZone && (() => {
        const label = t(`systems.${selectedZone.id}.short`);
        const w = label.length * 6.6 + 20;
        const [mx, my] = selectedZone.marker;
        const x = mx > 150 ? Math.min(mx + 16, 300 - w - 2) : Math.max(mx - 16 - w, 2);
        return (
          <G pointerEvents="none">
            <Rect x={x} y={my - 12} width={w} height={24} rx={12} fill="#13201A" />
            <SvgText x={x + w / 2} y={my + 4.5} textAnchor="middle" fill="#FFFFFF" fontSize={12} fontFamily="Lexend-Medium">
              {label}
            </SvgText>
          </G>
        );
      })()}
    </Svg>
  );
}

/** Memorizado: solo se redibuja si cambian estados, selección o tamaño. */
export const BodyFigure = memo(BodyFigureImpl);
