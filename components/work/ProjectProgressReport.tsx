"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { HealthBadge } from "@/components/work/kit";
import { scheduleHealth } from "@/lib/work-engine";
import { todayIST } from "@/lib/work-dates";
import type { ProjectProgressRow } from "@/lib/work-views";

/**
 * Reports › Progress: one bar per project showing approved (weighted)
 * progress, a tick where the schedule says it should be today, and the
 * schedule health in words. One series, so one hue (indigo); the tick and the
 * health label carry the rest, and every number is also written out beside
 * its bar, so nothing depends on colour or hover.
 */

const NO_DEPT = "No department";

export default function ProjectProgressReport({ rows }: { rows: ProjectProgressRow[] }) {
  const deptId = useId();
  const [dept, setDept] = useState("all");
  const [grouped, setGrouped] = useState(true);
  const today = todayIST();

  const departments = useMemo(
    () => [...new Set(rows.map((r) => r.department ?? NO_DEPT))].sort((a, b) => (a === NO_DEPT ? 1 : b === NO_DEPT ? -1 : a.localeCompare(b))),
    [rows]
  );
  const shown = rows.filter((r) => dept === "all" || (r.department ?? NO_DEPT) === dept);
  const groups: [string, ProjectProgressRow[]][] = grouped
    ? departments.map((d) => [d, shown.filter((r) => (r.department ?? NO_DEPT) === d)] as [string, ProjectProgressRow[]]).filter(([, l]) => l.length > 0)
    : [["", shown]];

  // Weighted by task count, like the preview's "Approved progress".
  const weight = shown.reduce((n, r) => n + Math.max(1, r.task_count), 0);
  const overall = weight ? Math.round(shown.reduce((n, r) => n + r.percent * Math.max(1, r.task_count), 0) / weight) : null;

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-10 text-center text-sm text-slate-500 ring-1 ring-slate-200">
        No active projects to report on yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* One filter row scopes everything below it. */}
      <div className="flex flex-wrap items-end gap-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div>
          <label htmlFor={deptId} className="mb-1 block text-xs font-medium text-slate-500">
            Department
          </label>
          <select
            id={deptId}
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All departments ({rows.length})</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
          Group by department
        </label>
        <dl className="ml-auto flex gap-6 pb-1">
          <div>
            <dt className="text-xs text-slate-500">Projects</dt>
            <dd className="figure text-lg font-semibold text-slate-900">{shown.length}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Approved progress</dt>
            <dd className="figure text-lg font-semibold text-slate-900">{overall === null ? "—" : `${overall}%`}</dd>
          </div>
        </dl>
      </div>

      <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200" aria-labelledby="progress-title">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="progress-title" className="text-base font-semibold text-slate-900">
            Progress by project
          </h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-3 rounded-sm bg-indigo-600" aria-hidden /> Approved
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-0.5 bg-slate-800" aria-hidden /> Where the schedule says it should be today
            </span>
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="text-sm text-slate-500">No projects in this department.</p>
        ) : (
          <div className="space-y-6">
            {groups.map(([name, list]) => (
              <div key={name || "all"}>
                {name && (
                  <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {name} <span className="figure font-normal normal-case text-slate-400">· {list.length}</span>
                    <span className="h-px flex-1 bg-slate-100" />
                  </h3>
                )}
                <ul className="space-y-4">
                  {list.map((r) => (
                    <ProgressRow key={r.id} row={r} today={today} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProgressRow({ row: r, today }: { row: ProjectProgressRow; today: string }) {
  const { expected } = scheduleHealth(r.percent, r.start_date?.slice(0, 10) ?? null, r.due_date?.slice(0, 10) ?? null, today);
  const behind = expected !== null ? Math.round(expected - r.percent) : 0;
  const summary = `${r.percent}% approved${expected !== null ? `, expected ${Math.round(expected)}% by today` : ""}`;
  return (
    <li>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <Link href={`/projects/${r.id}`} className="min-w-0 truncate text-sm font-medium text-slate-800 hover:text-indigo-700 hover:underline">
          {r.name}
        </Link>
        <HealthBadge approved={r.percent} start={r.start_date} due={r.due_date} />
      </div>
      <div className="relative h-3 w-full rounded bg-slate-100" role="img" aria-label={`${r.name}: ${summary}`} title={summary}>
        {r.percent > 0 && <div className="h-full rounded bg-indigo-600" style={{ width: `${r.percent}%` }} />}
        {expected !== null && (
          <div className="absolute -top-1 h-5 w-0.5 bg-slate-800" style={{ left: `calc(${Math.min(99.5, expected)}% - 1px)` }} />
        )}
      </div>
      <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-slate-500">
        <span>
          <span className="figure font-semibold text-slate-800">{r.percent}%</span> approved
          {expected !== null && <> · expected {Math.round(expected)}%</>}
          {behind > 0 && <> · {behind} points behind</>}
        </span>
        <span>
          · {r.done_count}/{r.task_count} tasks done
        </span>
        {r.review_count > 0 && <span className="text-amber-700">· {r.review_count} waiting for review</span>}
        {r.overdue_count > 0 && <span className="text-red-600">· {r.overdue_count} overdue</span>}
        {r.owner_name && <span>· Owner {r.owner_name}</span>}
      </p>
    </li>
  );
}
