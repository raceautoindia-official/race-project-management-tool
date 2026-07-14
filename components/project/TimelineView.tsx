"use client";

import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { STATUS_CHART_COLORS } from "@/lib/format";
import { TASK_STATUS_LABELS, type Milestone, type Task, type TaskStatus } from "@/lib/types";

function d(s?: string | null): Date | null {
  return s ? parseISO(String(s).slice(0, 10)) : null;
}

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
  const pct = (date: Date) => (differenceInCalendarDays(date, min) / totalDays) * 100;

  const weeks: Date[] = [];
  for (let cur = min; cur <= max; cur = addDays(cur, 7)) weeks.push(cur);

  const withBars = tasks
    .filter((t) => t.start_date || t.due_date)
    .sort((a, b) => {
      const sa = (a.start_date ?? a.due_date ?? "") as string;
      const sb = (b.start_date ?? b.due_date ?? "") as string;
      return sa.localeCompare(sb);
    });
  const msWithDates = milestones.filter((m) => m.due_date);
  const todayPct = pct(today);

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
      <div className="min-w-[720px]">
        {/* Header: week labels */}
        <div className="flex">
          <div className="w-44 shrink-0" />
          <div className="relative h-6 flex-1 border-b border-slate-100">
            {weeks.map((w, i) => (
              <div
                key={i}
                className="absolute -translate-x-1/2 text-[10px] text-slate-400"
                style={{ left: `${pct(w)}%` }}
              >
                {format(w, "d MMM")}
              </div>
            ))}
            {todayPct >= 0 && todayPct <= 100 && (
              <div
                className="absolute top-0 h-2 w-px bg-indigo-400"
                style={{ left: `${todayPct}%` }}
                title="Today"
              />
            )}
          </div>
        </div>

        {/* Milestones */}
        {msWithDates.length > 0 && (
          <div className="mt-2 flex">
            <div className="w-44 shrink-0 text-xs font-medium text-slate-500">
              Milestones
            </div>
            <div className="relative h-6 flex-1">
              {msWithDates.map((m) => (
                <div
                  key={m.id}
                  className={`absolute top-0 -translate-x-1/2 text-sm ${
                    m.is_done ? "text-green-600" : "text-amber-600"
                  }`}
                  style={{ left: `${pct(d(m.due_date)!)}%` }}
                  title={`${m.name} · ${m.due_date}`}
                >
                  ◆
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Task rows */}
        <div className="mt-2 space-y-1.5">
          {withBars.map((t) => {
            const s = d(t.start_date) ?? d(t.due_date)!;
            let e = d(t.due_date) ?? d(t.start_date)!;
            if (e < s) e = s;
            const left = pct(s);
            const width = Math.max(1.5, pct(addDays(e, 1)) - left);
            return (
              <div key={t.id} className="flex items-center">
                <div className="w-44 shrink-0 truncate pr-2 text-xs text-slate-600">
                  {t.title}
                </div>
                <div className="relative h-6 flex-1">
                  {todayPct >= 0 && todayPct <= 100 && (
                    <div
                      className="absolute inset-y-0 w-px bg-indigo-100"
                      style={{ left: `${todayPct}%` }}
                    />
                  )}
                  <button
                    onClick={() => onSelect(t)}
                    className="absolute top-1 h-4 rounded"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      background: STATUS_CHART_COLORS[t.status as TaskStatus],
                    }}
                    title={`${t.title} — ${TASK_STATUS_LABELS[t.status]} (${
                      t.start_date ?? "?"
                    } → ${t.due_date ?? "?"})`}
                  />
                </div>
              </div>
            );
          })}
          {withBars.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-400">
              No tasks have dates yet. Add a start or due date to see them on the timeline.
            </p>
          )}
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
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
        </div>
      </div>
    </div>
  );
}
