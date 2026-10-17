"use client";

// Panels shown for any task or subtask: discussion, time (man-hours) and files.

import { useState } from "react";
import Avatar from "@/components/Avatar";
import { useToast } from "@/components/ToastProvider";
import { usePreview } from "@/lib/preview/store";
import { can, hoursSummary, hrs, loggedHours, personById, plannedHours, projectById, subtasksOf, todayISO } from "@/lib/preview/engine";
import type { WorkItem } from "@/lib/preview/types";
import { Button, NotConnectedTag, ProgressBar, inputCls, timeAgo, useNotConnected } from "./ui";

export function Discussion({ item }: { item: WorkItem }) {
  const { state, me, addComment } = usePreview();
  const [body, setBody] = useState("");
  const project = projectById(state, item.projectId);
  const canComment = !!project && can(state, me.id, "comment", { project, item });
  const list = state.comments.filter((c) => c.itemId === item.id);

  return (
    <div>
      {list.length === 0 && <p className="mb-3 text-sm text-slate-500">No comments yet. Ask a question or share an update.</p>}
      <ul className="mb-4 space-y-3">
        {list.map((c) =>
          c.kind === "system" ? (
            <li key={c.id} className="flex items-center gap-2 text-xs text-slate-500">
              <span className="h-px flex-1 bg-slate-200" />
              <span>{personById(state, c.authorId)?.name}: {c.body} · {timeAgo(c.createdAt)}</span>
              <span className="h-px flex-1 bg-slate-200" />
            </li>
          ) : (
            <li key={c.id} className="flex gap-3">
              <Avatar name={personById(state, c.authorId)?.name ?? "?"} size="sm" />
              <div className="min-w-0 flex-1 rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500"><strong className="text-slate-800">{personById(state, c.authorId)?.name}</strong> · {timeAgo(c.createdAt)}</p>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{c.body}</p>
              </div>
            </li>
          )
        )}
      </ul>
      {canComment ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            addComment(item.id, body.trim());
            setBody("");
          }}
          className="flex gap-2"
        >
          <Avatar name={me.name} size="sm" />
          <div className="flex-1">
            <textarea
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write a comment… (use @name to mention someone)"
              className={inputCls}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
              }}
            />
            <div className="mt-1 flex items-center justify-between">
              <span className="text-xs text-slate-400">Ctrl+Enter to send · @mention emails <NotConnectedTag label="not connected" /></span>
              <Button type="submit" size="sm" disabled={!body.trim()}>Comment</Button>
            </div>
          </div>
        </form>
      ) : (
        <p className="text-xs text-slate-500">Only team members can comment.</p>
      )}
    </div>
  );
}

/** Expected vs actual man-hours as a small inline badge ("12h / 16h"). */
export function HoursBadge({ item }: { item: WorkItem }) {
  const { state } = usePreview();
  const planned = plannedHours(state, item);
  const logged = loggedHours(state, item);
  if (!planned && !logged) return <span className="text-xs text-slate-400">—</span>;
  const over = planned > 0 && logged > planned * 1.05;
  return (
    <span
      className={`text-xs tabular-nums ${over ? "font-medium text-red-600" : "text-slate-600"}`}
      title={`${hrs(logged)} man-hours logged of ${planned ? hrs(planned) : "no"} expected${over ? ` — ${hrs(logged - planned)} over` : ""}`}
    >
      {hrs(logged)} <span className="text-slate-400">/ {planned ? hrs(planned) : "—"}</span>
    </span>
  );
}

/** Plain-language verdict for finished work: under, on or over the estimate. */
export function EffortVerdict({ planned, actual }: { planned: number; actual: number }) {
  if (!planned || !actual) return null;
  const diff = ((actual - planned) / planned) * 100;
  const cls = diff > 20 ? "bg-red-50 text-red-700 ring-red-200" : diff < -20 ? "bg-sky-50 text-sky-700 ring-sky-200" : "bg-green-50 text-green-700 ring-green-200";
  const text = Math.abs(diff) < 5 ? "On estimate" : diff > 0 ? `${Math.round(diff)}% over estimate` : `${Math.round(-diff)}% under estimate`;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>{text}</span>;
}

export function TimePanel({ item }: { item: WorkItem }) {
  const { state, me, terms, addTimeLog, deleteTimeLog } = usePreview();
  const { toast } = useToast();
  const [hours, setHours] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const project = projectById(state, item.projectId);
  const hasSubs = !item.parentId && subtasksOf(state, item.id).length > 0;
  // Time is logged on the piece of work itself: a subtask, or a task without subtasks.
  const canLog = !!project && !hasSubs && can(state, me.id, "item.work", { project, item }) && item.status !== "cancelled";
  const sum = hoursSummary(state, { item });
  const ids = new Set([item.id, ...subtasksOf(state, item.id).map((x) => x.id)]);
  const entries = state.timeLogs.filter((l) => ids.has(l.itemId)).sort((a, b) => b.date.localeCompare(a.date));
  const over = sum.planned > 0 && sum.logged > sum.planned * 1.05;
  const finished = item.status === "done";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Expected" value={sum.planned ? hrs(sum.planned) : "—"} hint={hasSubs && sum.allocated !== sum.planned ? `${terms.subtask.many}: ${hrs(sum.allocated)}` : undefined} />
        <Tile label="Man-hours logged" value={hrs(sum.logged)} tone={over ? "red" : undefined} />
        <Tile label={over ? "Over by" : "Remaining"} value={sum.planned ? hrs(Math.abs(sum.planned - sum.logged)) : "—"} tone={over ? "red" : undefined} />
        <Tile label="People" value={String(sum.people.length)} />
      </div>

      {sum.planned > 0 && (
        <div>
          <ProgressBar value={{ approved: Math.min(100, sum.usedPct), pending: 0 }} />
          <p className={`mt-1 text-xs ${over ? "text-red-600" : "text-slate-500"}`}>
            {Math.round(sum.usedPct)}% of the expected hours used. Effort only — progress comes from approvals.
          </p>
        </div>
      )}

      {finished && <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">Completed in <strong>{hrs(sum.logged)}</strong> against <strong>{hrs(sum.planned)}</strong> expected <EffortVerdict planned={sum.planned} actual={sum.logged} /></div>}
      {hasSubs && sum.efficiency !== null && (
        <p className="text-xs text-slate-600">
          Approved {terms.subtask.many.toLowerCase()} so far took {hrs(sum.doneActual)} for {hrs(sum.earned)} of planned work
          (efficiency <strong>{Math.round(sum.efficiency)}%</strong>). At this pace the {terms.task.one.toLowerCase()} will need about <strong>{hrs(sum.forecast)}</strong>.
        </p>
      )}

      {sum.people.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Who worked on it</p>
          <ul className="space-y-1.5">
            {sum.people.map((p) => (
              <li key={p.personId} className="flex items-center gap-2 text-sm">
                <Avatar name={personById(state, p.personId)?.name ?? "?"} size="sm" />
                <span className="w-32 truncate text-slate-700">{personById(state, p.personId)?.name}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full bg-indigo-400" style={{ width: `${(p.hours / sum.logged) * 100}%` }} /></span>
                <span className="w-12 text-right text-xs tabular-nums text-slate-600">{hrs(p.hours)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canLog ? (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const h = Number(hours);
            if (!h || h <= 0) return;
            addTimeLog(item.id, { hours: h, date, note: note.trim() });
            toast(`Logged ${hrs(h)} on “${item.title}”`);
            setHours("");
            setNote("");
          }}
        >
          <label className="text-xs font-medium text-slate-600">
            Date
            <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className={`${inputCls} mt-0.5 w-40`} />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Hours
            <input type="number" step="0.25" min="0.25" max="24" value={hours} onChange={(e) => setHours(e.target.value)} className={`${inputCls} mt-0.5 w-24`} placeholder="1.5" />
          </label>
          <label className="min-w-40 flex-1 text-xs font-medium text-slate-600">
            What did you do? (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} mt-0.5`} placeholder="e.g. Fixed review comments" />
          </label>
          <Button type="submit" disabled={!Number(hours)}>Log time</Button>
        </form>
      ) : hasSubs ? (
        <p className="text-xs text-slate-500">Time is logged on each {terms.subtask.one.toLowerCase()}; this shows the total.</p>
      ) : null}

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Time entries ({entries.length})</p>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-500">No time logged yet.</p>
        ) : (
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {entries.map((l) => {
              const on = l.itemId !== item.id ? state.items.find((x) => x.id === l.itemId)?.title : null;
              return (
                <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-20 shrink-0 text-xs text-slate-500">{new Date(l.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-700">
                    <strong className="font-medium">{personById(state, l.personId)?.name}</strong>
                    {on && <span className="text-slate-500"> · {on}</span>}
                    {l.note && <span className="text-slate-500"> — {l.note}</span>}
                  </span>
                  <span className="text-xs font-medium tabular-nums text-slate-700">{hrs(l.hours)}</span>
                  {l.personId === me.id && (
                    <button onClick={() => deleteTimeLog(l.id)} className="text-xs text-slate-300 hover:text-red-600" aria-label="Delete entry">✕</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "red" }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone === "red" ? "text-red-600" : "text-slate-900"}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

export function FilesPanel() {
  const nc = useNotConnected();
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
      <p className="text-sm text-slate-600">Drag files here, or</p>
      <Button size="sm" variant="secondary" className="mt-2" onClick={nc("Attaching files")}>Choose a file</Button>
      <p className="mt-2"><NotConnectedTag label="Uploads not connected yet" /></p>
    </div>
  );
}
