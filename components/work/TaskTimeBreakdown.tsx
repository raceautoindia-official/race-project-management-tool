"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { formatMins, useWorkTimer } from "./work-timer-store";

interface TaskTime {
  totalMinutes: number;
  timerMinutes: number;
  manualMinutes: number;
  todayMinutes: number;
  estimateMinutes: number | null;
  byPerson: { userId: number | null; name: string; minutes: number }[];
  bySubtask: { id: number; title: string; status: string; minutes: number }[];
  running: { userId: number; name: string; subtaskTitle: string | null; startedAt: string }[];
}

function istTime(utc: string): string {
  return new Date(utc.replace(" ", "T") + "Z").toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Where a task's time went: by the work timer (checked against the
 * Attendance clock) and typed in by hand, by person and by subtask, and who
 * is on it right now. Re-reads whenever my own timer changes.
 */
export default function TaskTimeBreakdown({ taskId, refreshKey = 0 }: { taskId: number; refreshKey?: number }) {
  const [data, setData] = useState<TaskTime | null>(null);
  const timer = useWorkTimer();
  const mine = `${timer?.running?.sessionId ?? ""}|${timer?.readAt ?? ""}`;

  useEffect(() => {
    let live = true;
    apiFetch<TaskTime>(`/api/tasks/${taskId}/time`)
      .then((d) => live && setData(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [taskId, refreshKey, mine]);

  if (!data || (data.totalMinutes === 0 && data.running.length === 0)) return null;
  const subs = data.bySubtask.filter((s) => s.minutes > 0);

  return (
    <div className="mt-3 space-y-2 border-t border-slate-200 pt-2 text-xs text-slate-600">
      <p>
        <span className="font-medium text-emerald-700">⏱ {formatMins(data.timerMinutes)} by timer</span>
        {data.manualMinutes > 0 && <span> · {formatMins(data.manualMinutes)} added by hand</span>}
        {data.todayMinutes > 0 && <span> · {formatMins(data.todayMinutes)} today</span>}
      </p>
      {data.running.length > 0 && (
        <ul className="space-y-0.5">
          {data.running.map((r) => (
            <li key={r.userId} className="flex items-center gap-1.5 text-emerald-800">
              <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              {r.name} is on {r.subtaskTitle ? `“${r.subtaskTitle}”` : "it"} since {istTime(r.startedAt)}
            </li>
          ))}
        </ul>
      )}
      {data.byPerson.length > 1 && (
        <p>
          <span className="text-slate-500">By person: </span>
          {data.byPerson.map((p, i) => (
            <span key={p.userId ?? `x${i}`}>
              {i > 0 && " · "}
              {p.name} {formatMins(p.minutes)}
            </span>
          ))}
        </p>
      )}
      {subs.length > 0 && (
        <table className="w-full">
          <caption className="sr-only">Time by subtask</caption>
          <tbody>
            {subs.map((s) => (
              <tr key={s.id}>
                <td className="truncate py-0.5 pr-2">{s.title}</td>
                <td className="figure w-16 py-0.5 text-right font-medium text-slate-700">{formatMins(s.minutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
