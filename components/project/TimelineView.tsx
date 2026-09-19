"use client";

import { useEffect, useRef } from "react";
import {
  addDays,
  addMonths,
  addQuarters,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
} from "date-fns";
import { STATUS_CHART_COLORS } from "@/lib/format";
import { TASK_STATUS_LABELS, type Milestone, type Task, type TaskStatus } from "@/lib/types";

function d(s?: string | null): Date | null {
  return s ? parseISO(String(s).slice(0, 10)) : null;
}

type Unit = "day" | "week" | "month" | "quarter";

/**
 * How coarse the scale is, and how much room a day gets. A project can span a
 * fortnight or (with one stray date) a decade, so the scale follows the range
 * instead of always drawing a label per week — that is what turned a long
 * timeline into a smear of overlapping text.
 */
export function scaleFor(totalDays: number): { unit: Unit; pxPerDay: number } {
  if (totalDays <= 31) return { unit: "day", pxPerDay: 34 };
  if (totalDays <= 120) return { unit: "week", pxPerDay: 12 };
  if (totalDays <= 730) return { unit: "month", pxPerDay: 3.4 };
  return { unit: "quarter", pxPerDay: 1.2 };
}

export function ticksFor(unit: Unit, min: Date, max: Date): Date[] {
  const out: Date[] = [];
  const start =
    unit === "day"
      ? min
      : unit === "week"
        ? startOfWeek(min, { weekStartsOn: 1 })
        : unit === "month"
          ? startOfMonth(min)
          : startOfQuarter(min);
  const next = (c: Date) =>
    unit === "day"
      ? addDays(c, 1)
      : unit === "week"
        ? addDays(c, 7)
        : unit === "month"
          ? addMonths(c, 1)
          : addQuarters(c, 1);
  for (let cur = start; cur <= max; cur = next(cur)) {
    if (cur >= min) out.push(cur);
  }
  return out;
}

const LABEL_FORMAT: Record<Unit, string> = {
  day: "d MMM",
  week: "d MMM",
  month: "MMM ''yy",
  quarter: "MMM yyyy",
};

export default function TimelineView({
  tasks,
  milestones,
  onSelect,
}: {
  tasks: Task[];
  milestones: Milestone[];
  onSelect: (t: Task) => void;
}) {
  const dates: Date[] = [];
  for (const t of tasks) {
    const s = d(t.start_date);
    const du = d(t.due_date);
    if (s) dates.push(s);
    if (du) dates.push(du);
  }
  for (const m of milestones) {
    const du = d(m.due_date);
    if (du) dates.push(du);
  }
  const today = new Date();
  let min = dates.length
    ? new Date(Math.min(...dates.map((x) => x.getTime())))
    : addDays(today, -7);
  let max = dates.length
    ? new Date(Math.max(...dates.map((x) => x.getTime())))
    : addDays(today, 30);
  min = addDays(min, -2);
  max = addDays(max, 2);

  const totalDays = Math.max(1, differenceInCalendarDays(max, min));
  const { unit, pxPerDay } = scaleFor(totalDays);
  // Wide enough to read, capped so the browser isn't asked to paint a mile.
  const chartWidth = Math.min(6000, Math.max(680, Math.round(totalDays * pxPerDay)));
  const pct = (date: Date) => (differenceInCalendarDays(date, min) / totalDays) * 100;
  const toPx = (fromPct: number, toPctValue: number) =>
    ((toPctValue - fromPct) / 100) * chartWidth;

  // Drop labels that would collide at this width rather than stack them up.
  const allTicks = ticksFor(unit, min, max);
  const stride = Math.max(1, Math.ceil((allTicks.length * 76) / chartWidth));
  const ticks = allTicks.filter((_, i) => i % stride === 0);

  const withBars = tasks
    .filter((t) => t.start_date || t.due_date)
    .sort((a, b) => {
      const sa = (a.start_date ?? a.due_date ?? "") as string;
      const sb = (b.start_date ?? b.due_date ?? "") as string;
      return sa.localeCompare(sb);
    });
  const msWithDates = milestones.filter((m) => m.due_date);
  const todayPct = pct(today);
  const todayVisible = todayPct >= 0 && todayPct <= 100;

  const nameCol = "sticky left-0 z-20 w-44 shrink-0 bg-white pr-3";

  // One stray date (a task dated years ago) can push all the real work off
  // screen, so open the view near today rather than at the far left.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const focus = Math.min(100, Math.max(0, todayPct));
    el.scrollLeft = Math.max(0, (focus / 100) * chartWidth - el.clientWidth / 3);
  }, [todayPct, chartWidth]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div ref={scroller} className="overflow-x-auto">
        <div style={{ width: chartWidth + 176 }}>
          {/* Scale */}
          <div className="flex">
            <div className={`${nameCol} text-[11px] font-medium text-slate-500`}>
              {unit === "day"
                ? "Day"
                : unit === "week"
                  ? "Week starting"
                  : unit === "month"
                    ? "Month"
                    : "Quarter"}
            </div>
            <div className="relative h-5 flex-1 border-b border-slate-200">
              {ticks.map((t, i) => (
                <div
                  key={i}
                  className="absolute top-0 whitespace-nowrap pl-1 text-[10px] text-slate-600"
                  style={{ left: `${pct(t)}%` }}
                >
                  <span className="absolute -top-0.5 left-0 h-2 w-px bg-slate-300" />
                  {format(t, LABEL_FORMAT[unit])}
                </div>
              ))}
            </div>
          </div>

          {/* Rows, with the grid drawn behind them */}
          <div className="relative mt-1">
            <div className="pointer-events-none absolute inset-y-0 left-44 right-0">
              {ticks.map((t, i) => (
                <div
                  key={i}
                  className="absolute inset-y-0 w-px bg-slate-100"
                  style={{ left: `${pct(t)}%` }}
                />
              ))}
              {todayVisible && (
                <div
                  className="absolute inset-y-0 w-px bg-indigo-400"
                  style={{ left: `${todayPct}%` }}
                  title={`Today · ${format(today, "d MMM yyyy")}`}
                />
              )}
            </div>

            {msWithDates.length > 0 && (
              <div className="flex items-center">
                <div className={`${nameCol} text-xs font-medium text-slate-600`}>Milestones</div>
                <div className="relative h-7 flex-1">
                  {msWithDates.map((m) => (
                    <div
                      key={m.id}
                      className={`absolute top-1 -translate-x-1/2 text-sm ${
                        m.is_done ? "text-green-600" : "text-amber-600"
                      }`}
                      style={{ left: `${pct(d(m.due_date)!)}%` }}
                      title={`${m.name} · ${format(d(m.due_date)!, "d MMM yyyy")}`}
                    >
                      ◆
                    </div>
                  ))}
                </div>
              </div>
            )}

            {withBars.map((t) => {
              const s = d(t.start_date) ?? d(t.due_date)!;
              let e = d(t.due_date) ?? d(t.start_date)!;
              if (e < s) e = s;
              const left = pct(s);
              // A single day is a sliver on a long timeline: keep it clickable.
              const width = Math.max(10, toPx(left, pct(addDays(e, 1))));
              const dateOnly = !t.start_date || !t.due_date;
              const label = t.start_date
                ? `${format(s, "d MMM yyyy")} → ${t.due_date ? format(e, "d MMM yyyy") : "no due date"}`
                : `Due ${format(e, "d MMM yyyy")}`;
              return (
                <div key={t.id} className="flex items-center hover:bg-slate-50/60">
                  <div className={`${nameCol} truncate py-1 text-xs text-slate-600`} title={t.title}>
                    {t.title}
                  </div>
                  <div className="relative h-7 flex-1">
                    <button
                      onClick={() => onSelect(t)}
                      aria-label={`${t.title} — ${TASK_STATUS_LABELS[t.status]}, ${label}`}
                      className="absolute top-1.5 h-4 rounded shadow-sm ring-1 ring-black/5 hover:brightness-95"
                      style={{
                        left: `${left}%`,
                        width: `${width}px`,
                        background: STATUS_CHART_COLORS[t.status as TaskStatus],
                      }}
                      title={`${t.title} — ${TASK_STATUS_LABELS[t.status]} (${label})`}
                    />
                    {/* Without a range there is nothing to read off the bar. */}
                    {dateOnly && (
                      <span
                        className="pointer-events-none absolute top-1.5 whitespace-nowrap text-[10px] leading-4 text-slate-500"
                        style={{ left: `calc(${left}% + ${width + 6}px)` }}
                      >
                        {label}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {withBars.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-500">
                No tasks have dates yet. Add a start or due date to see them on the timeline.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
        {(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-3 rounded-sm"
              style={{ background: STATUS_CHART_COLORS[s] }}
            />
            {TASK_STATUS_LABELS[s]}
          </span>
        ))}
        <span className="flex items-center gap-1 text-amber-600">◆ Milestone</span>
        {todayVisible && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-px bg-indigo-400" /> Today
          </span>
        )}
        <span className="ml-auto text-slate-500">
          {format(min, "d MMM yyyy")} – {format(max, "d MMM yyyy")}
          {chartWidth > 680 ? " · scroll sideways" : ""}
        </span>
      </div>
    </div>
  );
}
