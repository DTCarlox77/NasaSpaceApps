/**
 * Gráficas del dashboard (Recharts). Una sola serie por gráfica (el título la nombra): línea de
 * 2 px, sin umbrales (la API no los manda en el dashboard y el panel no los inventa).
 * Los colores copian los tokens del tema (Recharts necesita valores, no variables CSS).
 */
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SeriesPoint } from '../../api/types.ts';
import { dateClock } from '../../lib/time.ts';
import { seriesSummary } from './crew.ts';

const CHART = {
  line: '#5fc6f5', // --color-accent
  surface: '#111922', // --color-surface
  raised: '#17212d', // --color-surface-raised
  grid: '#2b3b4d', // --color-border
  axis: '#a3b3c4', // --color-text-muted
  text: '#e8eef4', // --color-text
};

const numberFormat = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });

const toData = (points: SeriesPoint[]) =>
  [...points]
    .sort((a, b) => a.measured_at.localeCompare(b.measured_at))
    .map((p) => ({ t: p.measured_at, v: p.value }));

/** Sparkline de la tarjeta (sin ejes). */
export function Sparkline({ points, unit }: { points: SeriesPoint[]; unit?: string }) {
  const label = seriesSummary(points, unit);
  if (points.length < 2) return <span className="sparkline-empty muted">{label}</span>;
  return (
    <div className="sparkline" role="img" aria-label={label} title={label}>
      <LineChart width={120} height={36} data={toData(points)} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Line
          type="monotone"
          dataKey="v"
          stroke={CHART.line}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </div>
  );
}

/** Gráfica grande del detalle: ejes, rejilla tenue y tooltip con cursor. */
export function IndicatorChart({ points, unit, name }: { points: SeriesPoint[]; unit: string; name: string }) {
  const label = `${name}: ${seriesSummary(points, unit)}`;
  return (
    <div className="indicator-chart" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={220} initialDimension={{ width: 600, height: 220 }}>
        <LineChart data={toData(points)} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            tickFormatter={(t: string) => dateClock(t)}
            stroke={CHART.grid}
            tick={{ fill: CHART.axis, fontSize: 12 }}
            minTickGap={24}
          />
          <YAxis
            domain={['auto', 'auto']}
            width={48}
            stroke={CHART.grid}
            tick={{ fill: CHART.axis, fontSize: 12 }}
            tickFormatter={(n: number) => numberFormat.format(n)}
          />
          <Tooltip
            cursor={{ stroke: CHART.axis, strokeDasharray: '3 3' }}
            contentStyle={{
              background: CHART.raised,
              border: `1px solid ${CHART.grid}`,
              borderRadius: 4,
              color: CHART.text,
            }}
            labelStyle={{ color: CHART.axis }}
            itemStyle={{ color: CHART.text }}
            labelFormatter={(t) => dateClock(String(t))}
            formatter={(value) => [`${numberFormat.format(Number(value))}${unit ? ` ${unit}` : ''}`, name]}
          />
          <Line
            type="monotone"
            dataKey="v"
            stroke={CHART.line}
            strokeWidth={2}
            dot={{ r: 4, fill: CHART.line, stroke: CHART.surface, strokeWidth: 2 }}
            activeDot={{ r: 6, fill: CHART.line, stroke: CHART.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
