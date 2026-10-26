// Ties the modules this lazy chunk shares with the shell (React, JSX runtime, clsx) to the
// shell chunk, as every role chunk does, instead of splitting them into extra shared files
// the shell would download too (plan 4.10 budgets).
import '../../shell/SignedIn';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/**
 * The dashboard's charts (Recharts, plan 4.4 ChartCard). Loaded lazily by Dashboard.tsx, so
 * the chart library downloads only when an Admin opens the dashboard and never reaches another
 * role or the shell (plan 4.10). The charts are pictures for sighted users: each card also has
 * a table with the same numbers (the accessible alternative), and the chart itself is
 * aria-hidden. Colours are design tokens only.
 */
/** Design tokens (CSS variables) for the chart parts: no raw colours (CLAUDE.md rule 10). */
const token = {
  grid: 'var(--border)',
  text: 'var(--color-fg-muted)',
  cursor: 'var(--surface-2)',
  tooltip: {
    background: 'var(--surface-raised)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    color: 'var(--color-fg)',
  },
  bar: 'var(--brand)',
} as const;

export interface ChartPoint {
  label: string;
  /** Money in minor units. */
  value: number;
}

export function BarsChart({
  points,
  format,
  height = 240,
}: {
  points: ChartPoint[];
  format: (value: number) => string;
  height?: number;
}) {
  return (
    <div aria-hidden className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={points}
          margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
          // A picture only: the card's table tab is the accessible version (plan 4.7).
          accessibilityLayer={false}
        >
          <CartesianGrid vertical={false} stroke={token.grid} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: token.text, fontSize: 12 }}
            interval="preserveStartEnd"
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={72}
            tick={{ fill: token.text, fontSize: 12 }}
            tickFormatter={format}
          />
          <Tooltip
            cursor={{ fill: token.cursor }}
            formatter={(value) => format(Number(value))}
            contentStyle={token.tooltip}
          />
          <Bar dataKey="value" fill={token.bar} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default BarsChart;
