"use client";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export interface ChartDatum {
  name: string;
  value: number;
  color: string;
}

/**
 * How tall the ring is, in pixels.
 *
 * It is a number rather than a class because the chart is told the same
 * figure: asked for a height of "100%", the chart has nothing to measure on
 * its first render and writes a complaint about being -1 by -1 into the
 * server log on every dashboard load. Given a height it can read, it draws
 * quietly. The width stays proportional, so the ring still fits its column.
 */
const RING_HEIGHT = 224;

interface TipProps {
  active?: boolean;
  payload?: { payload: ChartDatum }[];
}

function Tip({ active, payload, total }: TipProps & { total: number }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const pct = total ? Math.round((d.value / total) * 100) : 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs shadow-sm">
      <span className="font-medium text-slate-700">{d.name}</span>
      <span className="ml-2 text-slate-600">
        {d.value} ({pct}%)
      </span>
    </div>
  );
}

export default function StatusChart({ data }: { data: ChartDatum[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-500">
        No tasks to chart yet.
      </div>
    );
  }
  return (
    <div>
      <div className="relative" style={{ height: RING_HEIGHT }}>
        <ResponsiveContainer width="100%" height={RING_HEIGHT}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={62}
              outerRadius={88}
              paddingAngle={2}
              cornerRadius={3}
              strokeWidth={0}
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<Tip total={total} />} />
          </PieChart>
        </ResponsiveContainer>
        {/* Center hero number */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-3xl font-bold text-slate-900">{total}</div>
          <div className="text-xs text-slate-500">tasks</div>
        </div>
      </div>

      {/* Legend with counts — identity is never colour-alone */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {data.map((d) => {
          const pct = total ? Math.round((d.value / total) * 100) : 0;
          return (
            <div key={d.name} className="flex items-center gap-2 text-sm">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: d.color }}
              />
              <span className="text-slate-600">{d.name}</span>
              <span className="ml-auto font-medium text-slate-700">
                {d.value}
                <span className="ml-1 text-xs font-normal text-slate-500">
                  {pct}%
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
