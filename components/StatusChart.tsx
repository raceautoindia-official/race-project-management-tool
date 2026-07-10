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
      <span className="ml-2 text-slate-500">
        {d.value} ({pct}%)
      </span>
    </div>
  );
}

export default function StatusChart({ data }: { data: ChartDatum[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-400">
        No tasks to chart yet.
      </div>
    );
  }
  return (
    <div>
      <div className="relative h-56">
        <ResponsiveContainer width="100%" height="100%">
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
          <div className="text-xs text-slate-400">tasks</div>
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
                <span className="ml-1 text-xs font-normal text-slate-400">
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
