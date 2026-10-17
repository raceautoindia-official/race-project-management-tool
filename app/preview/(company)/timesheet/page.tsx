"use client";

// Timesheet — one weekly grid where a person logs man-hours against every
// subtask (or leaf task) they work on. Totals are compared with the company's
// working hours to show capacity and utilisation.

import Link from "next/link";
import { useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { usePreview } from "@/lib/preview/store";
import {
  hrs,
  itemLink,
  loggedHours,
  personHours,
  plannedHours,
  projectById,
  subtasksOf,
  todayISO,
  weekOf,
} from "@/lib/preview/engine";
import type { WorkItem } from "@/lib/preview/types";
import { Button, Card, EmptyState, NotConnectedTag, PageHeader, StatusPill, inputCls, useNotConnected } from "@/components/preview/ui";

export default function TimesheetPage() {
  const { state, me, terms, addTimeLog, deleteTimeLog } = usePreview();
  const nc = useNotConnected();
  const [anchor, setAnchor] = useState(todayISO());
  const [extraRows, setExtraRows] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const week = weekOf(anchor);
  const today = todayISO();

  // Work this person can log against: leaf items assigned to them.
  const isLeaf = (i: WorkItem) => !!i.parentId || subtasksOf(state, i.id).length === 0;
  const mine = state.items.filter((i) => i.personId === me.id && isLeaf(i) && i.status !== "cancelled");
  const myLogs = state.timeLogs.filter((l) => l.personId === me.id && l.date >= week.start && l.date <= week.end);
  const rowIds = [...new Set([
    ...myLogs.map((l) => l.itemId),
    ...mine.filter((i) => i.status === "in_progress" || i.status === "not_started").map((i) => i.id),
    ...extraRows,
  ])];
  const rows = rowIds.map((id) => state.items.find((i) => i.id === id)).filter((x): x is WorkItem => !!x);
  const addable = mine.filter((i) => !rowIds.includes(i.id));

  const cell = (itemId: string, date: string) => myLogs.filter((l) => l.itemId === itemId && l.date === date).reduce((s, l) => s + l.hours, 0);
  const dayTotal = (date: string) => myLogs.filter((l) => l.date === date).reduce((s, l) => s + l.hours, 0);
  const dayCapacity = (date: string) => (state.org.workingDays.includes(parseISO(date).getDay()) ? state.org.workingHoursPerDay : 0);
  const weekTotal = myLogs.reduce((s, l) => s + l.hours, 0);
  const util = personHours(state, me.id, week.start, week.end);

  // Replace this person's hours for one item on one day.
  const setCell = (itemId: string, date: string, value: number) => {
    for (const l of myLogs.filter((x) => x.itemId === itemId && x.date === date)) deleteTimeLog(l.id);
    if (value > 0) addTimeLog(itemId, { hours: value, date, note: "" });
  };

  return (
    <div>
      <PageHeader
        title="Timesheet"
        subtitle={`Log the man-hours you spend on each ${terms.subtask.one.toLowerCase()}. Hours roll up to the ${terms.task.one.toLowerCase()} and ${terms.project.one.toLowerCase()} automatically.`}
        actions={
          <>
            <Button variant="secondary" onClick={nc("Submitting timesheets for approval")}>Submit week for approval</Button>
            <NotConnectedTag />
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" onClick={() => setAnchor(format(addDays(parseISO(week.start), -7), "yyyy-MM-dd"))} aria-label="Previous week">‹</Button>
          <Button size="sm" variant="secondary" onClick={() => setAnchor(todayISO())}>This week</Button>
          <Button size="sm" variant="secondary" onClick={() => setAnchor(format(addDays(parseISO(week.start), 7), "yyyy-MM-dd"))} aria-label="Next week">›</Button>
        </div>
        <span className="text-sm font-medium text-slate-800">
          {format(parseISO(week.start), "d MMM")} – {format(parseISO(week.end), "d MMM yyyy")}
        </span>
        <span className="ml-auto text-sm text-slate-600">
          <strong className="tabular-nums text-slate-900">{hrs(weekTotal)}</strong> logged of {hrs(util.capacity)} available so far
          <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${util.utilisation > 100 ? "bg-red-50 text-red-700" : util.utilisation >= 60 ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-800"}`}>
            {Math.round(util.utilisation)}% utilised
          </span>
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="🕒" title="Nothing to log yet" body={`When you're assigned a ${terms.subtask.one.toLowerCase()}, it appears here so you can log your hours.`} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Work</th>
                {week.days.map((d) => {
                  const off = dayCapacity(d) === 0;
                  return (
                    <th key={d} className={`w-16 px-1 py-2 text-center font-medium ${d === today ? "text-indigo-700" : ""} ${off ? "text-slate-300" : ""}`}>
                      {format(parseISO(d), "EEE")}
                      <span className="block text-[11px] font-normal">{format(parseISO(d), "d MMM")}</span>
                    </th>
                  );
                })}
                <th className="w-20 px-2 py-2 text-right font-medium">Week</th>
                <th className="w-28 px-3 py-2 text-right font-medium">All time / expected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((it) => {
                const rowTotal = week.days.reduce((s, d) => s + cell(it.id, d), 0);
                const planned = plannedHours(state, it);
                const all = loggedHours(state, it);
                const parent = it.parentId ? state.items.find((x) => x.id === it.parentId) : null;
                return (
                  <tr key={it.id}>
                    <td className="max-w-64 px-3 py-2">
                      <Link href={itemLink(state, it.id)} className="block truncate font-medium text-slate-800 hover:text-indigo-700">{it.title}</Link>
                      <span className="flex items-center gap-2 truncate text-xs text-slate-500">
                        <StatusPill status={it.status} />
                        <span className="truncate">{projectById(state, it.projectId)?.name}{parent ? ` › ${parent.title}` : ""}</span>
                      </span>
                    </td>
                    {week.days.map((d) => {
                      const v = cell(it.id, d);
                      const future = d > today;
                      return (
                        <td key={d} className={`px-1 py-2 text-center ${dayCapacity(d) === 0 ? "bg-slate-50" : ""}`}>
                          <input
                            key={`${it.id}-${d}-${v}`}
                            type="number"
                            min={0}
                            max={24}
                            step={0.5}
                            disabled={future || it.status === "done"}
                            defaultValue={v || ""}
                            onBlur={(e) => {
                              const n = Number(e.target.value) || 0;
                              if (n !== v) setCell(it.id, d, Math.min(24, Math.max(0, n)));
                            }}
                            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                            className="w-14 rounded-md border border-slate-200 px-1 py-1 text-center text-sm tabular-nums focus:border-indigo-400 focus:outline-none disabled:bg-transparent disabled:text-slate-400"
                            aria-label={`Hours on ${it.title}, ${d}`}
                          />
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-right font-medium tabular-nums text-slate-800">{rowTotal ? hrs(rowTotal) : "—"}</td>
                    <td className={`px-3 py-2 text-right text-xs tabular-nums ${planned && all > planned * 1.05 ? "font-medium text-red-600" : "text-slate-500"}`}>
                      {hrs(all)} / {planned ? hrs(planned) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50 text-xs">
              <tr>
                <td className="px-3 py-2 font-medium text-slate-700">Day total</td>
                {week.days.map((d) => {
                  const t = dayTotal(d);
                  const cap = dayCapacity(d);
                  return (
                    <td key={d} className={`px-1 py-2 text-center tabular-nums ${t > cap && cap > 0 ? "font-semibold text-red-600" : cap > 0 && d <= today && t < cap ? "text-amber-700" : "text-slate-700"}`} title={cap ? `${hrs(t)} of ${hrs(cap)} working hours` : "Non-working day"}>
                      {t ? hrs(t) : cap ? "0h" : "—"}
                    </td>
                  );
                })}
                <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-900">{hrs(weekTotal)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {addable.length > 0 && (
          <>
            <select value={adding ?? ""} onChange={(e) => setAdding(e.target.value || null)} className={`${inputCls} w-auto max-w-sm`} aria-label="Add a row">
              <option value="">Add a row for other work…</option>
              {addable.map((i) => <option key={i.id} value={i.id}>{i.title} — {projectById(state, i.projectId)?.name}</option>)}
            </select>
            <Button variant="secondary" disabled={!adding} onClick={() => { if (adding) setExtraRows((r) => [...r, adding]); setAdding(null); }}>Add row</Button>
          </>
        )}
        <span className="text-xs text-slate-500">
          Your company&apos;s work week: {state.org.workingHoursPerDay}h a day, {state.org.workingDays.length} days a week. Click a cell, type hours, press Enter.
        </span>
      </div>
    </div>
  );
}
