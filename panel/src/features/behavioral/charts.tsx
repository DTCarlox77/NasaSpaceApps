/**
 * Gráficas de Salud conductual (Recharts). Una serie por gráfica:
 * - Deslizador (0–100) con la banda del rango habitual estimado por el panel (área tenue).
 * - Tiempo de reacción de la PVT con su línea base (promedio de las corridas anteriores).
 * Los colores copian los tokens del tema (Recharts necesita valores, no variables CSS).
 */
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PvtRun, SeriesPoint } from '../../api/types.ts';
import { dateClock } from '../../lib/time.ts';
import type { UsualRange } from './behavioral.ts';

const CHART = {
  line: '#5fc6f5', // --color-accent
  band: '#3fcf8e', // --color-normal
  baseline: '#ffb547', // --color-caution
  surface: '#111922',
  raised: '#17212d',
  grid: '#2b3b4d',
  axis: '#a3b3c4',
  text: '#e8eef4',
};

const tooltipStyle = {
  contentStyle: { background: CHART.raised, border: `1px solid ${CHART.grid}`, borderRadius: 4, color: CHART.text },
  labelStyle: { color: CHART.axis },
  itemStyle: { color: CHART.text },
};

const dayLabel = (t: string) => dateClock(t).split(' ')[0] ?? t;

export function SliderChart({
  name,
  points,
  range,
}: {
  name: string;
  points: SeriesPoint[];
  range: UsualRange | null;
}) {
  const data = [...points]
    .sort((a, b) => a.measured_at.localeCompare(b.measured_at))
    .map((p) => ({ t: p.measured_at, v: p.value }));
  const label = `${name}: ${data.length} check-ins${range ? `, rango habitual ${range.low}–${range.high}` : ''}`;
  return (
    <div className="slider-chart" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={170} initialDimension={{ width: 420, height: 170 }}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
          {range ? (
            <ReferenceArea y1={range.low} y2={range.high} fill={CHART.band} fillOpacity={0.12} stroke={CHART.band} strokeOpacity={0.4} strokeDasharray="4 4" />
          ) : null}
          <XAxis dataKey="t" tickFormatter={dayLabel} stroke={CHART.grid} tick={{ fill: CHART.axis, fontSize: 11 }} minTickGap={20} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} width={32} stroke={CHART.grid} tick={{ fill: CHART.axis, fontSize: 11 }} />
          <Tooltip
            {...tooltipStyle}
            cursor={{ stroke: CHART.axis, strokeDasharray: '3 3' }}
            labelFormatter={(t) => dateClock(String(t))}
            formatter={(value) => [String(value), name]}
          />
          <Line type="monotone" dataKey="v" stroke={CHART.line} strokeWidth={2} dot={{ r: 3, fill: CHART.line, stroke: CHART.surface, strokeWidth: 1 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PvtChart({ runs, baselineMs }: { runs: PvtRun[]; baselineMs: number | null }) {
  const data = [...runs]
    .sort((a, b) => a.measured_at.localeCompare(b.measured_at))
    .map((r) => ({ t: r.measured_at, v: r.mean_rt_ms }));
  const label = `Tiempo medio de reacción de ${data.length} pruebas${baselineMs ? `, línea base ${baselineMs} ms` : ''}`;
  return (
    <div className="slider-chart" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={170} initialDimension={{ width: 420, height: 170 }}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
          {baselineMs ? (
            <ReferenceLine y={baselineMs} stroke={CHART.baseline} strokeDasharray="5 4" label={{ value: 'línea base', fill: CHART.baseline, fontSize: 11, position: 'insideTopLeft' }} />
          ) : null}
          <XAxis dataKey="t" tickFormatter={dayLabel} stroke={CHART.grid} tick={{ fill: CHART.axis, fontSize: 11 }} minTickGap={20} />
          <YAxis domain={['auto', 'auto']} width={40} stroke={CHART.grid} tick={{ fill: CHART.axis, fontSize: 11 }} unit=" ms" />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(t) => dateClock(String(t))}
            formatter={(value) => [`${String(value)} ms`, 'Tiempo medio']}
          />
          <Line type="monotone" dataKey="v" stroke={CHART.line} strokeWidth={2} dot={{ r: 3, fill: CHART.line, stroke: CHART.surface, strokeWidth: 1 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
