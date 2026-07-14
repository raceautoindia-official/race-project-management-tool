"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { STATUS_CHART_COLORS } from "@/lib/format";
import { TASK_STATUS_LABELS, type TaskStatus } from "@/lib/types";

export interface CalEvent {
  id: string;
  kind: "task" | "meeting" | "reminder";
  title: string;
  date: string; // YYYY-MM-DD
  time?: string | null; // HH:MM (meetings/reminders)
  status?: TaskStatus;
  category?: string; // reminders
  location?: string | null;
  projectId?: number | null;
  projectName?: string | null;
  href: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MEETING_COLOR = "#7c3aed"; // violet-600
const REMINDER_COLORS: Record<string, string> = {
  payment: "#059669",
  renewal: "#2563eb",
  follow_up: "#d97706",
  meeting: "#7c3aed",
  general: "#0d9488",
  custom: "#db2777",
};

function eventColor(e: CalEvent): string {
  if (e.kind === "reminder")
    return REMINDER_COLORS[e.category ?? "general"] ?? "#0d9488";
  if (e.kind === "meeting") return MEETING_COLOR;
  return STATUS_CHART_COLORS[(e.status ?? "todo") as TaskStatus];
}

export default function CalendarView({ events }: { events: CalEvent[] }) {
  const [cursor, setCursor] = useState(new Date());
  const [view, setView] = useState<"month" | "agenda">("month");
  const [showTasks, setShowTasks] = useState(true);
  const [showMeetings, setShowMeetings] = useState(true);
  const [showReminders, setShowReminders] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      events.filter(
        (e) =>
          (e.kind === "task" && showTasks) ||
          (e.kind === "meeting" && showMeetings) ||
          (e.kind === "reminder" && showReminders)
      ),
    [events, showTasks, showMeetings, showReminders]
  );

  const byDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of filtered) {
      const arr = m.get(e.date) ?? [];
      arr.push(e);
      m.set(e.date, arr);
    }
    for (const arr of m.values())
      arr.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
    return m;
  }, [filtered]);

  const gridStart = startOfWeek(startOfMonth(cursor));
  const gridEnd = endOfWeek(endOfMonth(cursor));
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const today = new Date();
  const selectedEvents = selected ? byDate.get(selected) ?? [] : [];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCursor((c) => subMonths(c, 1))}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            ‹
          </button>
          <button
            onClick={() => {
              setCursor(new Date());
              setSelected(null);
            }}
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
          <h3 className="ml-2 text-lg font-semibold text-slate-800">
            {format(cursor, "MMMM yyyy")}
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Filters */}
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showTasks}
              onChange={(e) => setShowTasks(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Tasks
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showMeetings}
              onChange={(e) => setShowMeetings(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Meetings
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showReminders}
              onChange={(e) => setShowReminders(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Reminders
          </label>
          {/* View toggle */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm">
            {(["month", "agenda"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 font-medium capitalize ${
                  view === v ? "bg-indigo-600 text-white" : "text-slate-600"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "month" ? (
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-slate-200 text-center text-xs font-medium text-slate-500">
          {WEEKDAYS.map((d) => (
            <div key={d} className="bg-slate-50 py-1.5">
              {d}
            </div>
          ))}
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const dayEvents = byDate.get(key) ?? [];
            const inMonth = isSameMonth(day, cursor);
            const isToday = isSameDay(day, today);
            return (
              <button
                key={key}
                onClick={() => setSelected(key)}
                className={`min-h-24 bg-white p-1 text-left align-top transition hover:bg-slate-50 ${
                  inMonth ? "" : "bg-slate-50/60 text-slate-300"
                } ${selected === key ? "ring-2 ring-inset ring-indigo-400" : ""}`}
              >
                <div
                  className={`mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                    isToday
                      ? "bg-indigo-600 font-semibold text-white"
                      : "text-slate-500"
                  }`}
                >
                  {format(day, "d")}
                </div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map((e) => (
                    <div
                      key={e.id}
                      title={e.title}
                      className="flex items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] text-slate-700"
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: eventColor(e) }}
                      />
                      <span className="truncate">
                        {e.time ? `${e.time} ` : ""}
                        {e.title}
                      </span>
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <div className="px-1 text-[10px] text-slate-400">
                      +{dayEvents.length - 3} more
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <AgendaView byDate={byDate} />
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
        {(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: STATUS_CHART_COLORS[s] }}
            />
            {TASK_STATUS_LABELS[s]}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ background: MEETING_COLOR }}
          />
          Meeting
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ background: REMINDER_COLORS.general }}
          />
          Reminder
        </span>
      </div>

      {/* Selected-day detail */}
      {view === "month" && selected && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="font-semibold text-slate-800">
              {format(parseISO(selected), "EEEE, d MMM yyyy")}
            </h4>
            <button
              onClick={() => setSelected(null)}
              className="text-sm text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
          {selectedEvents.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing scheduled.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {selectedEvents.map((e) => (
                <li key={e.id} className="py-2">
                  <Link href={e.href} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: eventColor(e) }}
                    />
                    <span className="text-sm font-medium text-slate-800 hover:text-indigo-600">
                      {e.time ? `${e.time} · ` : ""}
                      {e.title}
                    </span>
                    <span className="ml-auto text-xs capitalize text-slate-400">
                      {e.kind}
                      {e.projectName ? ` · ${e.projectName}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function AgendaView({ byDate }: { byDate: Map<string, CalEvent[]> }) {
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const upcoming = Array.from(byDate.entries())
    .filter(([date]) => date >= todayKey)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, 30);

  if (upcoming.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
        Nothing coming up.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {upcoming.map(([date, items]) => (
        <div key={date} className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
            {format(parseISO(date), "EEEE, d MMM yyyy")}
          </div>
          <ul className="divide-y divide-slate-100">
            {items.map((e) => (
              <li key={e.id} className="px-4 py-2">
                <Link href={e.href} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: eventColor(e) }}
                  />
                  <span className="text-sm text-slate-800 hover:text-indigo-600">
                    {e.time ? `${e.time} · ` : ""}
                    {e.title}
                  </span>
                  <span className="ml-auto text-xs capitalize text-slate-400">
                    {e.kind}
                    {e.projectName ? ` · ${e.projectName}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
