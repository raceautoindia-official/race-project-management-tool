"use client";

// Reports: a light, manager-friendly read on progress, workload and reviews.
// Everything is computed in the browser from the sample data; exporting and
// scheduled emails need the backend.

import Link from "next/link";
import { useMemo, useState } from "react";
import { differenceInCalendarDays, endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { usePreview } from "@/lib/preview/store";
import {
  hoursSummary,
  hrs,
  isOverdue,
  itemLink,
  loggedHours,
  pct,
  personHours,
  personById,
  projectById,
  projectHealth,
  reviewerIdFor,
  tasksOf,
  todayISO,
} from "@/lib/preview/engine";
import type { PreviewState, WorkItem } from "@/lib/preview/types";
import {
  Button,
  Card,
  EmptyState,
  HealthBadge,
  NotConnectedTag,
  PageHeader,
  PersonChip,
  SectionTitle,
  inputCls,
  timeAgo,
  useNotConnected,
} from "@/components/preview/ui";

// Single-series bar colour (validated: lightness, chroma, contrast on white).
const BAR = "#2a78d6";
// Status steps (data-viz status palette). Always paired with an icon + label.
const WARN = "#fab219";
const CRIT = "#d03b3b";

function loadBand(utilisation: number, capacity: number) {
  if (capacity <= 0) return { label: "No capacity", icon: "–", fill: "#cbd5e1", text: "text-slate-500" };
  if (utilisation > 100) return { label: "Overloaded", icon: "▲", fill: CRIT, text: "text-red-700" };
  if (utilisation >= 60) return { label: "Healthy", icon: "●", fill: BAR, text: "text-slate-600" };
  return { label: "Light load", icon: "▽", fill: WARN, text: "text-amber-800" };
}

function signedPct(n: number): string {
  const r = Math.round(n);
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r)}%`;
}

function isLeaf(s: PreviewState, i: WorkItem): boolean {
  return !!i.parentId || !s.items.some((x) => x.parentId === i.id);
}

const isOpen = (i: WorkItem) => i.status !== "done" && i.status !== "cancelled";

/** Approved on or before the due date. approvedAt is a timestamp; compare local dates. */
function onTime(i: WorkItem): boolean {
  if (!i.approvedAt || !i.dueDate || i.completedLate) return false;
  return format(parseISO(i.approvedAt), "yyyy-MM-dd") <= i.dueDate;
}

function onTimeRate(items: WorkItem[]): number | null {
  const done = items.filter((i) => i.status === "done" && i.dueDate && i.approvedAt);
  if (done.length === 0) return null;
  return (done.filter(onTime).length / done.length) * 100;
}

function deptOf(s: PreviewState, i: WorkItem): string {
  return personById(s, i.personId)?.departmentId ?? "none";
}

export default function ReportsPage() {
  const { state, terms } = usePreview();
  const notConnected = useNotConnected();
  const [dept, setDept] = useState("all");
  const [projectId, setProjectId] = useState("all");

  const data = useMemo(() => {
    const s = state;
    // Items in scope: project filter, then the department of the item's person.
    const items = s.items.filter(
      (i) =>
        i.status !== "cancelled" &&
        (projectId === "all" || i.projectId === projectId) &&
        (dept === "all" || deptOf(s, i) === dept)
    );

    const projects = s.projects.filter(
      (p) =>
        p.state === "active" &&
        (projectId === "all" || p.id === projectId) &&
        (dept === "all" || p.departmentId === dept || s.items.some((i) => i.projectId === p.id && deptOf(s, i) === dept))
    );
    const projectRows = projects.map((p) => ({ p, ...projectHealth(s, p), taskCount: tasksOf(s, p.id).filter((t) => t.status !== "cancelled").length }));
    const weight = projectRows.reduce((n, r) => n + Math.max(1, r.taskCount), 0);
    const overall = weight ? projectRows.reduce((n, r) => n + r.actual * Math.max(1, r.taskCount), 0) / weight : null;

    const deptRows = [...s.departments, { id: "none", name: "Unassigned / no department", color: "slate" }]
      .map((d) => {
        const list = items.filter((i) => deptOf(s, i) === d.id);
        return {
          d,
          open: list.filter(isOpen).length,
          done: list.filter((i) => i.status === "done").length,
          overdue: list.filter(isOverdue).length,
          onTime: onTimeRate(list),
          total: list.length,
        };
      })
      .filter((r) => r.total > 0);

    const levelRows = [...s.designations]
      .sort((a, b) => a.level - b.level)
      .map((g) => {
        const people = s.people.filter((p) => p.designationId === g.id && (dept === "all" || p.departmentId === dept));
        const ids = new Set(people.map((p) => p.id));
        return { g, people: people.length, open: items.filter((i) => isOpen(i) && i.personId && ids.has(i.personId)).length };
      })
      .filter((r) => r.people > 0);

    const now = new Date();
    const waiting = items
      .filter((i) => i.status === "in_review" && i.submittedAt)
      .map((i) => ({ i, days: differenceInCalendarDays(now, parseISO(i.submittedAt!)) }))
      .sort((a, b) => b.days - a.days);
    const buckets = [
      { label: "Under 1 day", test: (d: number) => d < 1 },
      { label: "1–2 days", test: (d: number) => d >= 1 && d <= 2 },
      { label: "3–7 days", test: (d: number) => d >= 3 && d <= 7 },
      { label: "Over a week", test: (d: number) => d > 7 },
    ].map((b) => ({ label: b.label, count: waiting.filter((w) => b.test(w.days)).length }));

    return {
      activeProjects: projects.length,
      overall,
      inReview: items.filter((i) => i.status === "in_review").length,
      overdue: items.filter(isOverdue).length,
      onTime: onTimeRate(items),
      projectRows,
      deptRows,
      levelRows,
      waiting,
      buckets,
    };
  }, [state, dept, projectId]);

  // ── Hours & effort ──
  const hours = useMemo(() => {
    const s = state;
    const today = parseISO(todayISO());
    const monthFrom = format(startOfMonth(today), "yyyy-MM-dd");
    const monthTo = format(endOfMonth(today), "yyyy-MM-dd");

    // Per project (same project list as "Progress by project", so the filters apply).
    const projectRows = data.projectRows.map(({ p }) => ({ p, h: hoursSummary(s, { project: p }) }));
    const sum = (f: (h: (typeof projectRows)[number]["h"]) => number) => projectRows.reduce((n, r) => n + f(r.h), 0);
    const planned = sum((h) => h.planned);
    const logged = sum((h) => h.logged);
    const earned = sum((h) => h.earned);
    const doneActual = sum((h) => h.doneActual);
    const forecast = sum((h) => h.forecast);
    const efficiency = doneActual > 0 ? (earned / doneActual) * 100 : null;
    const forecastVar = planned > 0 ? ((forecast - planned) / planned) * 100 : 0;
    const projectMax = Math.max(1, ...projectRows.map((r) => Math.max(r.h.planned, r.h.logged)));

    // Time entries in scope: project filter, and the department of the person who logged.
    const projectOfItem = new Map(s.items.map((i) => [i.id, i.projectId]));
    const loggerDept = (personId: string) => personById(s, personId)?.departmentId ?? "none";
    const logs = s.timeLogs.filter(
      (l) => (projectId === "all" || projectOfItem.get(l.itemId) === projectId) && (dept === "all" || loggerDept(l.personId) === dept)
    );

    const deptRows = [...s.departments, { id: "none", name: "No department", color: "slate" }]
      .filter((d) => dept === "all" || d.id === dept)
      .map((d) => {
        const members = s.people.filter((p) => (p.departmentId ?? "none") === d.id);
        const month = members.map((p) => personHours(s, p.id, monthFrom, monthTo));
        const capacity = month.reduce((n, m) => n + m.capacity, 0);
        const monthLogged = month.reduce((n, m) => n + m.logged, 0);
        return {
          d,
          people: members.length,
          logged: logs.filter((l) => loggerDept(l.personId) === d.id).reduce((n, l) => n + l.hours, 0),
          capacity,
          monthLogged,
          utilisation: capacity > 0 ? (monthLogged / capacity) * 100 : 0,
        };
      })
      .filter((r) => r.people > 0 || r.logged > 0);
    const deptMax = Math.max(1, ...deptRows.map((r) => r.logged));

    // Estimate accuracy on approved leaf items that have an estimate and some time logged.
    const accuracy = s.items
      .filter(
        (i) =>
          i.status === "done" &&
          (i.estimatedHours ?? 0) > 0 &&
          isLeaf(s, i) &&
          (projectId === "all" || i.projectId === projectId) &&
          (dept === "all" || deptOf(s, i) === dept)
      )
      .map((i) => {
        const est = i.estimatedHours ?? 0;
        const actual = loggedHours(s, i);
        return { i, est, actual, variance: ((actual - est) / est) * 100 };
      })
      .filter((r) => r.actual > 0);
    const accuracyBuckets = [
      { label: "Under by more than 20%", test: (v: number) => v < -20 },
      { label: "Within ±20%", test: (v: number) => v >= -20 && v <= 20 },
      { label: "Over by more than 20%", test: (v: number) => v > 20 },
    ].map((b) => ({ label: b.label, count: accuracy.filter((r) => b.test(r.variance)).length }));
    const overruns = accuracy
      .filter((r) => r.actual > r.est)
      .sort((a, b) => b.actual - b.est - (a.actual - a.est))
      .slice(0, 5);

    // Top contributors this month (inside the filters).
    const byPerson = new Map<string, number>();
    for (const l of logs) if (l.date >= monthFrom && l.date <= monthTo) byPerson.set(l.personId, (byPerson.get(l.personId) ?? 0) + l.hours);
    const contributors = [...byPerson.entries()]
      .map(([personId, h]) => ({ personId, hours: h }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 8);

    return {
      monthLabel: format(today, "MMMM yyyy"),
      planned,
      logged,
      earned,
      efficiency,
      forecast,
      forecastVar,
      projectRows,
      projectMax,
      deptRows,
      deptMax,
      accuracy,
      accuracyBuckets,
      overruns,
      contributors,
    };
  }, [state, data.projectRows, dept, projectId]);

  const maxLevel = Math.max(1, ...data.levelRows.map((r) => r.open));
  const maxBucket = Math.max(1, ...data.buckets.map((b) => b.count));
  const asOf = format(parseISO(todayISO()), "d MMM yyyy");

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle={`How your ${terms.project.many.toLowerCase()} are doing, as of ${asOf}. Only approved work counts as progress.`}
        actions={
          <>
            <div className="flex flex-col items-start gap-1 sm:items-end">
              <Button variant="secondary" onClick={notConnected("Export to Excel")}>⤓ Export to Excel</Button>
              <NotConnectedTag />
            </div>
            <div className="flex flex-col items-start gap-1 sm:items-end">
              <Button variant="secondary" onClick={notConnected("Scheduling a weekly email")}>✉ Schedule weekly email</Button>
              <NotConnectedTag />
            </div>
          </>
        }
      />

      {/* One filter row scopes everything below it. */}
      <Card className="mb-6 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Department</span>
            <select className={inputCls} value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="all">All departments</option>
              {state.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">{terms.project.one}</span>
            <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="all">All {terms.project.many.toLowerCase()}</option>
              {state.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
        {(dept !== "all" || projectId !== "all") && (
          <button onClick={() => { setDept("all"); setProjectId("all"); }} className="mt-3 text-xs font-medium text-indigo-600 hover:underline">
            Clear filters
          </button>
        )}
      </Card>

      {/* 1 · KPI tiles */}
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label={`Active ${terms.project.many.toLowerCase()}`} value={String(data.activeProjects)} />
        <Kpi label="Approved progress" value={data.overall === null ? "—" : pct(data.overall)} hint={`Average across active ${terms.project.many.toLowerCase()}, weighted by ${terms.task.many.toLowerCase()}`} />
        <Kpi label="Waiting for review" value={String(data.inReview)} tone={data.inReview ? "amber" : undefined} hint="Finished, but not counted until approved" />
        <Kpi label="Overdue" value={String(data.overdue)} tone={data.overdue ? "red" : undefined} hint="Past the due date and not done" />
        <Kpi label="On-time completion" value={data.onTime === null ? "—" : pct(data.onTime)} hint="Approved on or before the due date" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 2 · Progress by project */}
        <Card className="p-5 lg:col-span-2">
          <SectionTitle count={data.projectRows.length}>Progress by {terms.project.one.toLowerCase()}</SectionTitle>
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm" style={{ background: BAR }} /> Approved</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-slate-800" /> Where the schedule says it should be today</span>
          </div>
          {data.projectRows.length === 0 ? (
            <EmptyState icon="📊" title={`No active ${terms.project.many.toLowerCase()} match`} body="Try clearing the filters." />
          ) : (
            <ul className="space-y-4">
              {data.projectRows.map(({ p, actual, expected, health }) => (
                <li key={p.id}>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/preview/projects/${p.id}`} className="min-w-0 truncate text-sm font-medium text-slate-800 hover:text-indigo-600 hover:underline">
                      {p.name}
                    </Link>
                    <HealthBadge health={health} expected={expected} />
                  </div>
                  <div
                    className="relative h-3 w-full rounded bg-slate-100"
                    role="img"
                    aria-label={`${p.name}: ${pct(actual)} approved, expected ${pct(expected)} by today`}
                    title={`${pct(actual)} approved · expected ${pct(expected)} by today`}
                  >
                    <div className="h-full rounded" style={{ width: `${actual}%`, background: BAR }} />
                    <div className="absolute -top-1 h-5 w-0.5 bg-slate-800" style={{ left: `calc(${Math.min(99.5, expected)}% - 1px)` }} />
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    <span className="font-semibold text-slate-800">{pct(actual)}</span> approved · expected {pct(expected)}
                    {expected - actual > 0.5 && <span> · {Math.round(expected - actual)} points behind</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* 3 · By department (a table: easiest to scan, and screen-reader friendly) */}
        <Card className="p-5 lg:col-span-2">
          <SectionTitle>By department</SectionTitle>
          <p className="mb-3 -mt-1 text-xs text-slate-500">Each {terms.task.one.toLowerCase()} and {terms.subtask.one.toLowerCase()} counts under the department of the person it belongs to.</p>
          {data.deptRows.length === 0 ? (
            <p className="text-sm text-slate-500">No work matches these filters.</p>
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-2 pr-3 font-medium">Department</th>
                    <th className="px-3 py-2 text-right font-medium">Open</th>
                    <th className="px-3 py-2 text-right font-medium">Done</th>
                    <th className="px-3 py-2 text-right font-medium">Overdue</th>
                    <th className="py-2 pl-3 font-medium">On-time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.deptRows.map((r) => (
                    <tr key={r.d.id}>
                      <td className="py-2.5 pr-3 text-slate-800">{r.d.name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{r.open}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{r.done}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${r.overdue ? "font-semibold text-red-600" : "text-slate-400"}`}>
                        {r.overdue ? `⚠ ${r.overdue}` : 0}
                      </td>
                      <td className="py-2.5 pl-3">
                        {r.onTime === null ? (
                          <span className="text-xs text-slate-400">Nothing finished yet</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-24 rounded bg-slate-100" aria-hidden>
                              <div className="h-full rounded" style={{ width: `${r.onTime}%`, background: BAR }} />
                            </div>
                            <span className="text-xs font-medium tabular-nums text-slate-700">{pct(r.onTime)}</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* 4 · Workload by designation level */}
        <Card className="p-5">
          <SectionTitle>Open work by level</SectionTitle>
          <p className="mb-4 -mt-1 text-xs text-slate-500">Open {terms.task.many.toLowerCase()} and {terms.subtask.many.toLowerCase()} held by people at each designation level.</p>
          {data.levelRows.length === 0 ? (
            <p className="text-sm text-slate-500">No people match these filters.</p>
          ) : (
            <HBars
              rows={data.levelRows.map((r) => ({
                key: r.g.id,
                label: `L${r.g.level} · ${r.g.name}`,
                sub: `${r.people} ${r.people === 1 ? "person" : "people"}`,
                value: r.open,
              }))}
              max={maxLevel}
              unit="open"
            />
          )}
        </Card>

        {/* 5 · Pending reviews ageing */}
        <Card className="p-5">
          <SectionTitle count={data.waiting.length}>How long reviews are waiting</SectionTitle>
          <p className="mb-4 -mt-1 text-xs text-slate-500">Finished work doesn&apos;t count until it&apos;s approved, so long waits hold progress back.</p>
          {data.waiting.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing is waiting for review. 🎉</p>
          ) : (
            <>
              <HBars rows={data.buckets.map((b) => ({ key: b.label, label: b.label, value: b.count }))} max={maxBucket} unit="items" />
              <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Waiting longest</h3>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {data.waiting.slice(0, 5).map(({ i }) => (
                  <li key={i.id}>
                    <Link href={itemLink(state, i.id)} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-slate-50">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-800">{i.title}</span>
                        <span className="block truncate text-xs text-slate-500">{projectById(state, i.projectId)?.name}</span>
                      </span>
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        Reviewer <PersonChip id={reviewerIdFor(state, i)} emptyLabel="No reviewer" />
                      </span>
                      <span className="text-xs font-medium text-amber-800">sent {timeAgo(i.submittedAt!)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      {/* ── Hours & effort ─────────────────────────────────────────────── */}
      <div className="mb-4 mt-10 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Hours &amp; effort</h2>
          <p className="text-sm text-slate-500">Planned (expected) hours against the man-hours people have logged.</p>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <Button variant="secondary" onClick={notConnected("Exporting timesheets")}>⤓ Export timesheets (Excel)</Button>
          <NotConnectedTag />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Planned hours" value={hrs(hours.planned)} hint={`Expected hours of active ${terms.project.many.toLowerCase()} (allocated hours where no budget is set)`} />
        <Kpi label="Man-hours logged" value={hrs(hours.logged)} hint={hours.planned > 0 ? `${pct((hours.logged / hours.planned) * 100)} of plan used` : undefined} />
        <Kpi label="Earned hours" value={hrs(hours.earned)} hint="Expected hours of approved work" />
        <Kpi
          label="Effort efficiency"
          value={hours.efficiency === null ? "—" : pct(hours.efficiency)}
          tone={hours.efficiency !== null && hours.efficiency < 80 ? "amber" : undefined}
          hint="Earned ÷ actual on approved work. 100% = on estimate; lower means it took longer"
        />
        <Kpi
          label="Forecast at completion"
          value={hrs(hours.forecast)}
          tone={hours.forecastVar > 10 ? "red" : hours.forecastVar > 0 ? "amber" : undefined}
          hint={hours.planned > 0 ? `${signedPct(hours.forecastVar)} vs plan of ${hrs(hours.planned)}` : "No plan to compare against"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Planned vs actual by project */}
        <Card className="p-5 lg:col-span-2">
          <SectionTitle count={hours.projectRows.length}>Planned vs actual by {terms.project.one.toLowerCase()}</SectionTitle>
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm" style={{ background: BAR }} /> Man-hours logged</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-slate-800" /> Planned hours</span>
          </div>
          {hours.projectRows.length === 0 ? (
            <EmptyState icon="⏱" title={`No active ${terms.project.many.toLowerCase()} match`} body="Try clearing the filters." />
          ) : (
            <>
              <ul className="space-y-4">
                {hours.projectRows.map(({ p, h }) => {
                  const over = h.planned > 0 && h.logged > h.planned;
                  return (
                    <li key={p.id}>
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                        <Link href={`/preview/projects/${p.id}`} className="min-w-0 truncate text-sm font-medium text-slate-800 hover:text-indigo-600 hover:underline">
                          {p.name}
                        </Link>
                        <span className="text-xs text-slate-500">
                          <span className="font-semibold text-slate-800">{hrs(h.logged)}</span> of {hrs(h.planned)}
                        </span>
                      </div>
                      <div
                        className="relative h-3 w-full rounded bg-slate-100"
                        role="img"
                        aria-label={`${p.name}: ${hrs(h.logged)} logged of ${hrs(h.planned)} planned, forecast ${hrs(h.forecast)}`}
                        title={`${hrs(h.logged)} logged · ${hrs(h.planned)} planned · forecast ${hrs(h.forecast)}`}
                      >
                        <div
                          className="h-full rounded"
                          style={{ width: `${(h.logged / hours.projectMax) * 100}%`, minWidth: h.logged ? 4 : 0, background: BAR }}
                        />
                        {h.planned > 0 && (
                          <div
                            className="absolute -top-1 h-5 w-0.5 bg-slate-800"
                            style={{ left: `calc(${Math.min(99.5, (h.planned / hours.projectMax) * 100)}% - 1px)` }}
                          />
                        )}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {h.planned > 0 ? <>{pct(h.usedPct)} of plan used</> : <>No plan set</>} · forecast {hrs(h.forecast)}
                        {h.planned > 0 && Math.abs(h.forecastVariancePct) >= 0.5 && (
                          <span className={h.forecastVariancePct > 10 ? "font-medium text-red-700" : ""}>
                            {" "}({h.forecastVariancePct > 10 && <span aria-hidden>▲ </span>}{signedPct(h.forecastVariancePct)} vs plan)
                          </span>
                        )}
                        {over && <span className="font-medium text-red-700"> · already over plan</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="-mx-5 mt-6 overflow-x-auto px-5">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="py-2 pr-3 font-medium">{terms.project.one}</th>
                      <th className="px-3 py-2 text-right font-medium">Planned</th>
                      <th className="px-3 py-2 text-right font-medium">Logged</th>
                      <th className="px-3 py-2 text-right font-medium">Used</th>
                      <th className="px-3 py-2 text-right font-medium">Efficiency</th>
                      <th className="px-3 py-2 text-right font-medium">Forecast</th>
                      <th className="py-2 pl-3 text-right font-medium">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {hours.projectRows.map(({ p, h }) => (
                      <tr key={p.id}>
                        <td className="py-2.5 pr-3 text-slate-800">{p.name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{hrs(h.planned)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{hrs(h.logged)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{h.planned > 0 ? pct(h.usedPct) : "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{h.efficiency === null ? "—" : pct(h.efficiency)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{hrs(h.forecast)}</td>
                        <td className={`py-2.5 pl-3 text-right tabular-nums ${h.forecastVariancePct > 10 ? "font-semibold text-red-700" : "text-slate-800"}`}>
                          {h.planned > 0 ? <>{h.forecastVariancePct > 10 && <span aria-hidden>▲ </span>}{signedPct(h.forecastVariancePct)}</> : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>

        {/* Hours by department */}
        <Card className="p-5 lg:col-span-2">
          <SectionTitle>Hours by department</SectionTitle>
          <p className="-mt-1 mb-3 text-xs text-slate-500">
            Man-hours count under the department of the person who logged them (all time, within the filters). Utilisation is for {hours.monthLabel}: hours logged ÷ working-day capacity.
          </p>
          {hours.deptRows.length === 0 ? (
            <p className="text-sm text-slate-500">No departments match these filters.</p>
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="py-2 pr-3 font-medium">Department</th>
                    <th className="px-3 py-2 font-medium">Man-hours logged</th>
                    <th className="px-3 py-2 text-right font-medium">This month</th>
                    <th className="py-2 pl-3 font-medium">Utilisation ({format(parseISO(todayISO()), "MMM")})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {hours.deptRows.map((r) => {
                    const band = loadBand(r.utilisation, r.capacity);
                    return (
                      <tr key={r.d.id}>
                        <td className="py-2.5 pr-3">
                          <div className="text-slate-800">{r.d.name}</div>
                          <div className="text-xs text-slate-400">{r.people} {r.people === 1 ? "person" : "people"}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2" title={`${r.d.name}: ${hrs(r.logged)} logged`}>
                            <div className="h-3 w-32 rounded bg-slate-100" aria-hidden>
                              <div className="h-full rounded" style={{ width: `${(r.logged / hours.deptMax) * 100}%`, minWidth: r.logged ? 4 : 0, background: BAR }} />
                            </div>
                            <span className="text-xs font-medium tabular-nums text-slate-700">{hrs(r.logged)}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">
                          {hrs(r.monthLogged)} of {hrs(r.capacity)}
                        </td>
                        <td className="py-2.5 pl-3">
                          <div className="flex items-center gap-2" title={`${pct(r.utilisation)} utilisation · ${band.label}`}>
                            <div className="h-2 w-24 overflow-hidden rounded bg-slate-100" aria-hidden>
                              <div className="h-full rounded" style={{ width: `${Math.min(100, r.utilisation)}%`, background: band.fill }} />
                            </div>
                            <span className={`text-xs font-medium tabular-nums ${band.text}`}>
                              <span aria-hidden>{band.icon}</span> {pct(r.utilisation)} · {band.label}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Estimate accuracy */}
        <Card className="p-5">
          <SectionTitle count={hours.accuracy.length}>Estimate accuracy</SectionTitle>
          <p className="-mt-1 mb-4 text-xs text-slate-500">
            Approved {terms.task.many.toLowerCase()} and {terms.subtask.many.toLowerCase()} with an estimate and time logged: actual vs estimated hours.
          </p>
          {hours.accuracy.length === 0 ? (
            <p className="text-sm text-slate-500">No approved work with both an estimate and logged time yet.</p>
          ) : (
            <>
              <HBars
                rows={hours.accuracyBuckets.map((b) => ({ key: b.label, label: b.label, value: b.count }))}
                max={Math.max(1, ...hours.accuracyBuckets.map((b) => b.count))}
                unit="items"
              />
              <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Biggest overruns</h3>
              {hours.overruns.length === 0 ? (
                <p className="text-sm text-slate-500">Nothing went over its estimate.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {hours.overruns.map(({ i, est, actual, variance }) => (
                    <li key={i.id}>
                      <Link href={itemLink(state, i.id)} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-slate-50">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-800">{i.title}</span>
                          <span className="block truncate text-xs text-slate-500">{projectById(state, i.projectId)?.name}</span>
                        </span>
                        <span className="text-xs tabular-nums text-slate-500">
                          {hrs(actual)} vs {hrs(est)} est.
                        </span>
                        <span className="text-xs font-semibold tabular-nums text-red-700">
                          <span aria-hidden>▲ </span>+{hrs(actual - est)} ({signedPct(variance)})
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>

        {/* Top contributors */}
        <Card className="p-5">
          <SectionTitle>Top contributors</SectionTitle>
          <p className="-mt-1 mb-4 text-xs text-slate-500">Most man-hours logged in {hours.monthLabel}, within the filters.</p>
          {hours.contributors.length === 0 ? (
            <p className="text-sm text-slate-500">No time logged this month yet.</p>
          ) : (
            <HBars
              rows={hours.contributors.map((c) => {
                const person = personById(state, c.personId);
                return {
                  key: c.personId,
                  label: person?.name ?? "Unknown",
                  sub: state.departments.find((d) => d.id === person?.departmentId)?.name ?? "No department",
                  value: c.hours,
                };
              })}
              max={Math.max(1, ...hours.contributors.map((c) => c.hours))}
              unit="logged"
              fmt={hrs}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "red" | "amber" }) {
  const color = tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-700" : "text-slate-900";
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-xs leading-snug text-slate-400">{hint}</div>}
    </Card>
  );
}

/** Thin horizontal bars, one hue, value labelled at the tip. */
function HBars({ rows, max, unit, fmt = String }: { rows: { key: string; label: string; sub?: string; value: number }[]; max: number; unit: string; fmt?: (n: number) => string }) {
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 sm:grid-cols-[minmax(0,11rem)_1fr]">
          <div className="min-w-0">
            <div className="truncate text-sm text-slate-800" title={r.label}>{r.label}</div>
            {r.sub && <div className="truncate text-xs text-slate-400">{r.sub}</div>}
          </div>
          <div className="flex items-center gap-2" title={`${r.label}: ${fmt(r.value)} ${unit}`}>
            <div
              className="h-3 rounded-r"
              style={{ width: `calc(${(r.value / max) * 100}% - 2.5rem)`, minWidth: r.value ? 4 : 0, background: BAR }}
              aria-hidden
            />
            <span className="shrink-0 text-xs font-medium tabular-nums text-slate-700">{fmt(r.value)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
