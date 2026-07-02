"use client";

import { useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { STATUS_CHART_COLORS } from "@/lib/format";
import type { Task, TaskStatus } from "@/lib/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Calendar({
  tasks,
  onSelect,
}: {
  tasks: Task[];
  onSelect: (task: Task) => void;
}) {
  const [cursor, setCursor] = useState(new Date());

  const gridStart = startOfWeek(startOfMonth(cursor));
  const gridEnd = endOfWeek(endOfMonth(cursor));
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const byDate = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.due_date) continue;
    const key = t.due_date.slice(0, 10);
    const arr = byDate.get(key) ?? [];
    arr.push(t);
    byDate.set(key, arr);
  }

  const today = new Date();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-800">
          {format(cursor, "MMMM yyyy")}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCursor((c) => subMonths(c, 1))}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            ‹
          </button>
          <button
            onClick={() => setCursor(new Date())}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Today
          </button>
          <button
            onClick={() => setCursor((c) => addMonths(c, 1))}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-slate-200 text-center text-xs font-medium text-slate-500">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-slate-50 py-1.5">
            {d}
          </div>
        ))}
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayTasks = byDate.get(key) ?? [];
          const inMonth = isSameMonth(day, cursor);
          const isToday = isSameDay(day, today);
          return (
            <div
              key={key}
              className={`min-h-24 bg-white p-1 text-left align-top ${
                inMonth ? "" : "bg-slate-50/60 text-slate-300"
              }`}
            >
              <div
                className={`mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                  isToday ? "bg-indigo-600 font-semibold text-white" : "text-slate-500"
                }`}
              >
                {format(day, "d")}
              </div>
              <div className="space-y-0.5">
                {dayTasks.slice(0, 3).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onSelect(t)}
                    title={t.title}
                    className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] text-slate-700 hover:bg-slate-100"
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: STATUS_CHART_COLORS[t.status as TaskStatus] }}
                    />
                    <span className="truncate">{t.title}</span>
                  </button>
                ))}
                {dayTasks.length > 3 && (
                  <div className="px-1 text-[10px] text-slate-400">
                    +{dayTasks.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
